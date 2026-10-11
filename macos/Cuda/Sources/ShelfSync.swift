import SwiftUI
import AppKit
import CoreImage.CIFilterBuiltins

struct MacSyncStatus: Decodable {
    var enabled = false
    var offline = true
    var id = ""
    var port = 0
    var addresses: [String] = []
    var fingerprint = ""
    var token = ""
    var message = "Off"
}
@MainActor
final class MacShelfSync: ObservableObject {
    @Published var status = MacSyncStatus()
    @Published var busy = false
    @Published var message = "Enable sync to pair your iPhone or iPad."
    @Published var lastSync: Date?
    private unowned let store: Store
    private var journal = ShelfSyncJournal()
    private var timer: Task<Void, Never>?
    private var pending: Task<Void, Never>?
    private var service: NetService?
    private var applying = false
    private var file: URL { store.runtime.directory.appendingPathComponent("native-sync-journal.json") }
    init(store: Store) {
        self.store = store
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(ShelfSyncJournal.self, from: data) { journal = saved }
    }
    var pairingLink: String {
        guard status.enabled, let address = status.addresses.first else { return "" }
        var url = URLComponents(); url.scheme = "cuda-sync"; url.host = "pair"
        url.queryItems = [.init(name: "address", value: address), .init(name: "key", value: status.token), .init(name: "cert", value: status.fingerprint), .init(name: "id", value: status.id)]
        return url.string ?? ""
    }
    func start() {
        changed()
        Task { do { status = try JSONDecoder().decode(MacSyncStatus.self, from: await store.runtime.call("syncStatus")); advertise(); if status.enabled { await sync() } } catch { message = error.localizedDescription } }
        timer = Task { [weak self] in while !Task.isCancelled { try? await Task.sleep(for: .seconds(10)); guard !Task.isCancelled, let self else { return }; if self.status.enabled { await self.sync() } } }
    }
    func changed() {
        guard !applying else { return }
        journal.capture(store.state); persist()
        pending?.cancel(); pending = Task { [weak self] in try? await Task.sleep(for: .milliseconds(350)); guard !Task.isCancelled, let self, self.status.enabled else { return }; await self.sync() }
    }
    func configure(enabled: Bool? = nil, offline: Bool? = nil, reset: Bool = false) async {
        var args: [String: Any] = ["reset": reset]; if let enabled { args["enabled"] = enabled }; if let offline { args["offline"] = offline }
        do { status = try JSONDecoder().decode(MacSyncStatus.self, from: await store.runtime.call("syncConfigure", args)); advertise(); message = status.message; if status.enabled { await sync() } }
        catch { message = error.localizedDescription }
    }
    func sync() async {
        guard !busy, store.ready else { return }; busy = true; defer { busy = false }
        do {
            let records = try JSONSerialization.jsonObject(with: JSONEncoder().encode(Array(journal.records.values)))
            let data = try await store.runtime.call("syncExchange", ["records": records])
            let result = try JSONDecoder().decode(ShelfSyncEnvelope.self, from: data)
            // Local mutations may have arrived while the helper was responding.
            journal.merge(result.records)
            let local: [Track] = try await store.runtime.api("/api/library")
            applying = true; store.state.local = local; journal.apply(to: &store.state); store.save(); applying = false; persist()
            lastSync = Date(); message = "Ready · \(result.assets.count) offline songs available"
        } catch { applying = false; message = "Sync paused. " + error.localizedDescription }
    }
    private func persist() { do { try JSONEncoder().encode(journal).write(to: file, options: .atomic); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path) } catch { message = "Sync changes could not be saved. Check free disk space." } }
    private func advertise() {
        service?.stop(); service = nil
        guard status.enabled else { return }
        let value = NetService(domain: "local.", type: "_cuda-sync._tcp.", name: "Cuda-" + status.id, port: Int32(status.port))
        value.setTXTRecord(NetService.data(fromTXTRecord: ["id": Data(status.id.utf8)])); value.publish(); service = value
    }
}
struct MacSyncSettings: View {
    @ObservedObject var sync: MacShelfSync
    @State private var resetting = false
    var body: some View {
        Section("Device sync") {
            Toggle("Sync with iPhone and iPad", isOn: Binding(get: { sync.status.enabled }, set: { value in Task { await sync.configure(enabled: value) } }))
            if sync.status.enabled {
                Toggle("Automatically sync offline songs", isOn: Binding(get: { sync.status.offline }, set: { value in Task { await sync.configure(offline: value) } }))
                if !sync.pairingLink.isEmpty {
                    HStack(alignment: .center, spacing: 20) {
                        if let image = qr(sync.pairingLink) { Image(nsImage: image).interpolation(.none).resizable().frame(width: 144, height: 144).padding(10).background(.white, in: RoundedRectangle(cornerRadius: 12)).accessibilityLabel("Device pairing QR code") }
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Pair once. Keep your music together.").font(.headline)
                            Text("Scan this code with your iPhone Camera, then confirm in Cuda. Or copy the link and paste it in iOS Settings → Device sync.").font(.callout).foregroundStyle(.secondary)
                            Button("Copy pairing link", systemImage: "doc.on.doc") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(sync.pairingLink, forType: .string) }
                        }
                    }
                } else { Text("Connect your Mac to Wi-Fi to display a pairing code.").foregroundStyle(.secondary) }
                HStack { Button("Sync now", systemImage: "arrow.triangle.2.circlepath") { Task { await sync.sync() } }.disabled(sync.busy); if sync.busy { ProgressView().controlSize(.small) }; Button("Reset pairing", role: .destructive) { resetting = true } }
            }
            Text(sync.message).font(.callout).foregroundStyle(.secondary)
            Text("Favourites and playlists sync both ways. New imported or downloaded songs copy automatically, without duplicates. Keep Cuda open on the Mac; devices must be on the same local network. Connections are encrypted and tied to this pairing code.").font(.callout).foregroundStyle(.secondary)
        }.confirmationDialog("Disconnect previously paired devices?", isPresented: $resetting) { Button("Reset pairing", role: .destructive) { Task { await sync.configure(reset: true) } } }
    }
    private func qr(_ value: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator(); filter.message = Data(value.utf8); filter.correctionLevel = "M"
        guard let output = filter.outputImage, let cg = CIContext().createCGImage(output.transformed(by: CGAffineTransform(scaleX: 6, y: 6)), from: output.extent.applying(CGAffineTransform(scaleX: 6, y: 6))) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }
}
