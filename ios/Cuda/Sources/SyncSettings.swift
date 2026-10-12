import SwiftUI

struct DeviceSyncPrompt: ViewModifier {
    @ObservedObject var sync: DeviceSync
    func body(content: Content) -> some View {
        content.alert("Pair with this Cuda Mac?", isPresented: Binding(get: { sync.pendingPair != nil }, set: { if !$0 { sync.pendingPair = nil } })) {
            Button("Pair & sync") { if let candidate = sync.pendingPair { Task { await sync.pair(candidate) } } }
            Button("Cancel", role: .cancel) { sync.pendingPair = nil }
        } message: {
            Text("Your playlists, favourites, offline songs, provider keys and Spotify library authorization will sync with the Mac whose pairing code you scanned. Use this only with your own Mac.")
        }
    }
}

struct DeviceSyncSettings: View {
    @ObservedObject var sync: DeviceSync
    @State private var link = ""
    var body: some View {
        Section {
            if sync.pairing == nil {
                TextField("Paste Mac pairing link", text: $link).textInputAutocapitalization(.never).autocorrectionDisabled().privacySensitive()
                Button("Pair Mac", systemImage: "link") {
                    do { let value = try SyncPairing.parse(link); Task { await sync.pair(value); if sync.pairing != nil { link = "" } } } catch { sync.message = error.localizedDescription }
                }.disabled(sync.busy || link.isEmpty)
            } else {
                Toggle("Automatic sync", isOn: $sync.enabled)
                Toggle("Sync offline songs", isOn: $sync.offline)
                Button("Sync now", systemImage: "arrow.triangle.2.circlepath") { Task { await sync.sync() } }.disabled(sync.busy)
                Button("Disconnect Mac", role: .destructive) { sync.disconnect() }
            }
            if sync.busy { HStack { ProgressView(); Text(sync.progress.isEmpty ? "Syncing your Shelf…" : sync.progress).font(.subheadline) } }
            Text(sync.message).font(.subheadline).foregroundStyle(.secondary)
            if let last = sync.lastSync { LabeledContent("Last synced") { Text(last, style: .relative).font(.subheadline) } }
        } header: { Text("Device sync") } footer: {
            Text("Enable Device sync in Cuda’s Mac Settings. Scan its code with Camera or paste its pairing link here. Favourites, playlists and offline songs sync over encrypted Wi-Fi. Spotify library authorization and provider keys also sync automatically. YouTube and SoundCloud connect automatically too. Keep Cuda open on your awake Mac. iOS schedules background checks when allowed and catches up whenever you open Cuda.")
        }
    }
}
