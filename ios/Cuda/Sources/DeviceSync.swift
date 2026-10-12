import Foundation
import Security
import CryptoKit
import Network
import BackgroundTasks
import UIKit

struct SyncPairing: Codable, Identifiable {
    var address: String
    var key: String
    var fingerprint: String
    var id: String
    static func parse(_ raw: String) throws -> SyncPairing {
        guard let url = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)), url.scheme == "cuda-sync", url.host == "pair" else { throw CudaError.message("Paste a Cuda pairing link from Mac Settings → Device sync.") }
        func item(_ key: String) -> String { url.queryItems?.first { $0.name == key }?.value ?? "" }
        let address = item("address"), key = item("key"), fingerprint = item("cert"), id = item("id")
        guard let endpoint = URLComponents(string: address), endpoint.scheme == "https", let host = endpoint.host,
              Companion.validAddress("http://" + host + (endpoint.port.map { ":\($0)" } ?? "")),
              endpoint.user == nil, endpoint.password == nil, endpoint.query == nil, endpoint.fragment == nil, endpoint.path.isEmpty,
              key.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              fingerprint.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, UUID(uuidString: id) != nil else {
            throw CudaError.message("This pairing link is invalid. Copy a fresh link from Cuda on your Mac.")
        }
        return SyncPairing(address: address, key: key, fingerprint: fingerprint, id: id)
    }
}
final class SyncTrust: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    let fingerprint: String
    init(_ fingerprint: String) { self.fingerprint = fingerprint }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else { completionHandler(.performDefaultHandling, nil); return }
        guard let trust = challenge.protectionSpace.serverTrust, let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let cert = chain.first else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        let data = SecCertificateCopyData(cert) as Data
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard hash == fingerprint else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        SecTrustSetPolicies(trust, SecPolicyCreateBasicX509()); SecTrustSetAnchorCertificates(trust, [cert] as CFArray); SecTrustSetAnchorCertificatesOnly(trust, true)
        guard SecTrustEvaluateWithError(trust, nil) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
struct SyncConnection {
    let pairing: SyncPairing
    let session: URLSession
    init(_ pairing: SyncPairing, waitsForConnectivity: Bool = true) {
        self.pairing = pairing
        let configuration = URLSessionConfiguration.ephemeral; configuration.waitsForConnectivity = waitsForConnectivity; configuration.timeoutIntervalForRequest = 45; configuration.timeoutIntervalForResource = 300; configuration.allowsCellularAccess = false
        session = URLSession(configuration: configuration, delegate: SyncTrust(pairing.fingerprint), delegateQueue: nil)
    }
    func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: pairing.address + path) else { throw CudaError.message("Invalid Mac address.") }
        var req = URLRequest(url: url); req.httpMethod = method; req.httpBody = body
        req.setValue("Bearer " + pairing.key, forHTTPHeaderField: "Authorization"); if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }; return req
    }
    func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw CudaError.message((response as? HTTPURLResponse)?.statusCode == 401 ? "Pairing was reset. Pair your Mac again." : "Open Cuda on your Mac and connect to the same Wi-Fi.") }
    }
    func exchange(_ records: [ShelfSyncRecord]) async throws -> ShelfSyncEnvelope {
        let (data, response) = try await session.data(for: request("/sync/exchange", method: "POST", body: JSONEncoder().encode(ShelfSyncEnvelope(records: records))))
        try validate(response); guard data.count <= 8_000_000 else { throw CudaError.message("Shelf response was too large.") }
        return try JSONDecoder().decode(ShelfSyncEnvelope.self, from: data)
    }
    func health() async throws -> String {
        struct Health: Decodable { var id: String; var version: Int }
        let (data, response) = try await session.data(for: request("/sync/health")); try validate(response)
        let value = try JSONDecoder().decode(Health.self, from: data); guard value.version == 1, value.id == pairing.id else { throw CudaError.message("This is a different Mac. Pair it in Settings.") }; return value.id
    }
    func downloadOffline(_ track: Track, to root: URL) async throws -> String {
        struct Job: Decodable { var id: String; var status: String; var filename: String?; var hash: String?; var size: Int64?; var error: String? }
        let body = try JSONSerialization.data(withJSONObject: ["track": JSONSerialization.jsonObject(with: JSONEncoder().encode(track))])
        let (data, response) = try await session.data(for: request("/sync/offline-download", method: "POST", body: body))
        try validate(response)
        var job = try JSONDecoder().decode(Job.self, from: data)
        guard job.id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw CudaError.message("Invalid offline download.") }
        for _ in 0..<240 {
            try Task.checkCancellation()
            if job.status == "ready" { break }
            if job.status == "failed" { throw CudaError.message(job.error ?? "This public source could not be downloaded.") }
            try await Task.sleep(for: .milliseconds(500))
            let (data, response) = try await session.data(for: request("/sync/offline-status?id=" + job.id)); try validate(response)
            let next = try JSONDecoder().decode(Job.self, from: data)
            guard next.id == job.id else { throw CudaError.message("Offline download changed unexpectedly.") }; job = next
        }
        guard job.status == "ready", let filename = job.filename, filename == job.id + ".m4a", let hash = job.hash, hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, let size = job.size, size > 0, size <= 512 * 1024 * 1024 else { throw CudaError.message("Offline download is not ready. Try again.") }
        let (temp, downloadResponse) = try await session.download(for: request("/sync/offline-file?id=" + job.id))
        defer { try? FileManager.default.removeItem(at: temp) }; try validate(downloadResponse)
        guard (try temp.resourceValues(forKeys: [.fileSizeKey])).fileSize == Int(size), try await DeviceSync.digest(temp) == hash else { throw CudaError.message("Offline audio verification failed. Retry this song.") }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let target = root.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
        try FileManager.default.moveItem(at: temp, to: target)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: target.path)
        return filename
    }
    func integrations() async throws -> IntegrationSetup? {
        var req = try request("/sync/integrations"); req.timeoutInterval = 20
        let (data, response) = try await session.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 404 { return nil }
        try validate(response)
        guard data.count < 32_000 else { throw CudaError.message("Account setup response was too large.") }
        let value = try JSONDecoder().decode(IntegrationSetup.self, from: data)
        try value.validate(for: pairing.id); return value
    }
    func companion() async throws -> PairedCompanion? {
        var req = try request("/sync/companion"); req.timeoutInterval = 5
        let (data, response) = try await session.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 404 { return nil }
        try validate(response)
        guard data.count < 8_000 else { throw CudaError.message("Invalid streaming companion response.") }
        return try JSONDecoder().decode(CompanionSetup.self, from: data).connection(address: pairing.address, macID: pairing.id)
    }
}
@MainActor
final class DeviceSync: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    static let backgroundID = "com.veikkaheiskanen.Cuda.shelf-sync"
    @Published var pairing: SyncPairing?
    @Published var pendingPair: SyncPairing?
    @Published var busy = false
    @Published var message = "Pair once to keep your Mac and iPhone Shelf together."
    @Published var progress = ""
    @Published var lastSync: Date?
    @Published private(set) var integrations: IntegrationSetup?
    @Published private(set) var integrationStatus = "Accounts and provider keys connect automatically when you pair a Mac."
    @Published private(set) var playback: PairedCompanion?
    @Published private(set) var playbackStatus = "Pair in Device sync to connect YouTube and SoundCloud automatically."
    @Published var enabled: Bool { didSet { UserDefaults.standard.set(enabled, forKey: "sync-enabled"); if enabled { schedule(); Task { await sync() } } else { connectionSession?.invalidateAndCancel(); BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.backgroundID) } } }
    @Published var offline: Bool { didSet { UserDefaults.standard.set(offline, forKey: "sync-offline"); if offline { Task { await sync() } } } }
    private unowned let store: Store
    private var journal = ShelfSyncJournal()
    private var timer: Task<Void, Never>?
    private var pending: Task<Void, Never>?
    private var browser: NetServiceBrowser?
    private var resolving: [NetService] = []
    private var monitor: NWPathMonitor?
    private var active = false
    private var connectionSession: URLSession?
    private var file: URL { store.root.appendingPathComponent("sync-journal.json") }
    init(store: Store) {
        self.store = store; enabled = UserDefaults.standard.object(forKey: "sync-enabled") as? Bool ?? true; offline = UserDefaults.standard.object(forKey: "sync-offline") as? Bool ?? true
        super.init()
        if let data = Keychain.read("device-sync").data(using: .utf8) { pairing = try? JSONDecoder().decode(SyncPairing.self, from: data) }
        if let data = Keychain.read("device-companion").data(using: .utf8), let saved = try? JSONDecoder().decode(PairedCompanion.self, from: data), saved.macID == pairing?.id {
            playback = saved; playbackStatus = "Connected through Device sync."
        }
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(ShelfSyncJournal.self, from: data) { journal = saved }
        if let data = Keychain.read("device-integrations").data(using: .utf8), let saved = try? JSONDecoder().decode(IntegrationSetup.self, from: data), let id = pairing?.id, (try? saved.validate(for: id)) != nil {
            integrations = saved; store.spotify.applyMacSetup(saved.spotify)
        }
        journal.capture(store.state); persist()
    }
    func activate(_ foreground: Bool) {
        active = foreground; timer?.cancel()
        guard foreground else { schedule(); return }
        if monitor == nil { let value = NWPathMonitor(); value.pathUpdateHandler = { [weak self] path in if path.status == .satisfied { Task { @MainActor in guard let self, self.active else { return }; await self.sync() } } }; value.start(queue: DispatchQueue(label: "Cuda.Sync.Network")); monitor = value }
        discover(); Task { await sync() }
        timer = Task { [weak self] in while !Task.isCancelled { try? await Task.sleep(for: .seconds(15)); guard !Task.isCancelled, let self else { return }; await self.sync() } }
    }
    func changed() {
        journal.capture(store.state); persist()
        pending?.cancel(); pending = Task { [weak self] in try? await Task.sleep(for: .milliseconds(500)); guard !Task.isCancelled, let self else { return }; await self.sync() }
    }
    func offer(_ url: URL) { do { pendingPair = try SyncPairing.parse(url.absoluteString) } catch { message = error.localizedDescription } }
    func pair(_ candidate: SyncPairing) async {
        guard !busy else { return }; busy = true
        let connection = SyncConnection(candidate); defer { connection.session.invalidateAndCancel(); busy = false }
        do {
            _ = try await connection.health()
            try Keychain.write(String(data: JSONEncoder().encode(candidate), encoding: .utf8)!, account: "device-sync")
            integrations = nil; store.spotify.applyMacSetup(nil); try? Keychain.write("", account: "device-integrations")
            pairing = candidate; pendingPair = nil; enabled = true; message = "Paired with your Mac."; discover()
            UserDefaults.standard.set(false, forKey: "companionManualOverride")
            playback = nil; await refreshPlayback(connection); await refreshIntegrations(connection)
        } catch { message = "Could not pair. " + error.localizedDescription; return }
        Task { await sync() }
    }
    func disconnect() {
        setupRefresh?.cancel(); setupRefresh = nil; setupRefreshID = UUID()
        connectionSession?.invalidateAndCancel(); pending?.cancel(); timer?.cancel(); browser?.stop(); browser = nil
        if playback != nil && !UserDefaults.standard.bool(forKey: "companionManualOverride") { store.player.disconnectCompanion() }
        try? Keychain.write("", account: "device-sync"); try? Keychain.write("", account: "device-companion")
        playback = nil; playbackStatus = "Pair in Device sync to connect streaming automatically."
        try? Keychain.write("", account: "device-integrations")
        integrations = nil; store.spotify.applyMacSetup(nil)
        integrationStatus = "Pair a Mac to connect accounts and provider keys automatically."
        pairing = nil; enabled = false; message = "Disconnected. Your saved music stays on this device."
    }
    private var setupRefresh: Task<Void, Never>?
    private var setupRefreshID = UUID()
    func refreshPlaybackConnection() async {
        if let setupRefresh { await setupRefresh.value; return }
        guard let pairing else { return }
        let id = UUID(); setupRefreshID = id
        let task = Task { [weak self] in
            guard let self else { return }
            let connection = SyncConnection(pairing, waitsForConnectivity: false)
            defer { connection.session.invalidateAndCancel() }
            await self.refreshPlayback(connection)
            await self.refreshIntegrations(connection)
        }
        setupRefresh = task; await task.value
        if setupRefreshID == id { setupRefresh = nil }
    }
    private func refreshPlayback(_ connection: SyncConnection) async {
        do {
            let value = try await connection.companion()
            guard pairing?.id == connection.pairing.id, pairing?.key == connection.pairing.key, pairing?.address == connection.pairing.address else { return }
            if let value {
                if playback?.address != value.address || playback?.token != value.token || playback?.macID != value.macID {
                    try Keychain.write(String(data: JSONEncoder().encode(value), encoding: .utf8)!, account: "device-companion")
                }
                playback = value; playbackStatus = "Connected through Device sync."
            } else {
                playback = nil; try? Keychain.write("", account: "device-companion")
                playbackStatus = "Update Cuda on your Mac to 1.0.6 or later for automatic streaming setup."
            }
        } catch {
            if pairing?.id == connection.pairing.id, pairing?.address == connection.pairing.address {
                playback = nil
                playbackStatus = "Streaming connection paused. " + error.localizedDescription
            }
        }
    }
    func configureAccounts(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: "sync-accounts")
        if !enabled {
            integrations = nil; store.spotify.applyMacSetup(nil)
            try? Keychain.write("", account: "device-integrations")
            integrationStatus = "Automatic account setup is off."
        } else { Task { await refreshPlaybackConnection() } }
    }
    private func refreshIntegrations(_ connection: SyncConnection) async {
        guard UserDefaults.standard.object(forKey: "sync-accounts") as? Bool != false else { return }
        do {
            let value = try await connection.integrations()
            guard UserDefaults.standard.object(forKey: "sync-accounts") as? Bool != false, pairing?.id == connection.pairing.id, pairing?.key == connection.pairing.key, pairing?.address == connection.pairing.address else { return }
            if let value {
                let data = try JSONEncoder().encode(value)
                if Keychain.read("device-integrations") != String(decoding: data, as: UTF8.self) { try Keychain.write(String(decoding: data, as: UTF8.self), account: "device-integrations") }
                integrations = value; store.spotify.applyMacSetup(value.spotify)
                integrationStatus = "Account and provider setup synced from your Mac."
            } else {
                integrations = nil; store.spotify.applyMacSetup(nil); try? Keychain.write("", account: "device-integrations")
                integrationStatus = "Update Cuda on your Mac for automatic account setup."
            }
        } catch {
            guard pairing?.id == connection.pairing.id, pairing?.key == connection.pairing.key else { return }
            integrationStatus = "Account setup paused. Reconnect to your Mac to refresh it."
        }
    }
    func sync() async {
        if !enabled { await refreshPlaybackConnection(); return }
        guard enabled, let pairing, !busy else { return }; busy = true; defer { busy = false; progress = ""; schedule() }
        let connection = SyncConnection(pairing); connectionSession = connection.session; defer { connection.session.invalidateAndCancel(); connectionSession = nil }
        do {
            await refreshPlayback(connection)
            await refreshIntegrations(connection)
            journal.capture(store.state); persist()
            let result = try await connection.exchange(Array(journal.records.values)); journal.merge(result.records); apply()
            if offline && result.offline != false {
                let remote = Set(result.assets.map(\.hash))
                for track in store.state.local {
                    try Task.checkCancellation()
                    guard let name = track.localFile else { continue }; let file = store.audioRoot.appendingPathComponent(name)
                    let hash = try await Self.digest(file); if remote.contains(hash) { continue }
                    let ext = file.pathExtension.lowercased(); guard Self.extensions.contains(ext) else { continue }
                    progress = "Sending \(track.title)…"
                    var request = try connection.request("/sync/files/" + hash + "?ext=" + ext, method: "PUT")
                    request.setValue(String((try file.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0), forHTTPHeaderField: "Content-Length")
                    request.setValue(try JSONEncoder().encode(ShelfSyncJournal.clean(track)).base64EncodedString(), forHTTPHeaderField: "X-Cuda-Track")
                    let (_, response) = try await connection.session.upload(for: request, fromFile: file); try connection.validate(response)
                }
                for asset in result.assets {
                    try Task.checkCancellation()
                    guard asset.hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, asset.filename == "local_" + String(asset.hash.prefix(12)) + "." + URL(fileURLWithPath: asset.filename).pathExtension,
                          Self.extensions.contains(URL(fileURLWithPath: asset.filename).pathExtension), asset.track.id == "local_" + String(asset.hash.prefix(12)), asset.track.platform == "local", asset.size > 0, asset.size <= 512 * 1024 * 1024 else { throw CudaError.message("Mac returned invalid offline-song metadata.") }
                    let existing = store.state.local.first { $0.key == asset.track.key }?.localFile
                    let dest = store.audioRoot.appendingPathComponent(existing ?? asset.filename)
                    if !FileManager.default.fileExists(atPath: dest.path) {
                        progress = "Downloading \(asset.track.title)…"
                        let (temp, response) = try await connection.session.download(for: connection.request("/sync/files/" + asset.hash))
                        do { try connection.validate(response); let size = (try temp.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
                            guard size == asset.size, try await Self.digest(temp) == asset.hash else { throw CudaError.message("Audio checksum failed. Sync will retry.") }
                            try FileManager.default.moveItem(at: temp, to: dest)
                        } catch { try? FileManager.default.removeItem(at: temp); throw error }
                    }
                    var local = asset.track; local.id = "local_" + String(asset.hash.prefix(12)); local.platform = "local"; local.localFile = dest.lastPathComponent; local.url = ""
                    if !store.state.local.contains(where: { $0.key == local.key }) { store.state.local.append(local) }
                }
                // Uploaded songs are now on the Mac; get any edits made during transfer.
                let latest = try await connection.exchange(Array(journal.records.values)); journal.merge(latest.records); apply()
            }
            lastSync = Date(); message = "Up to date · \(store.state.local.count) offline songs"
        } catch is CancellationError { message = "Sync paused. It will resume when connected." }
        catch { message = "Sync paused. " + error.localizedDescription; discover() }
    }
    private var applying = false
    private func apply() { applying = true; journal.apply(to: &store.state); store.save(); applying = false; persist() }
    func recordChange() { if !applying { changed() } }
    private func persist() { do { try JSONEncoder().encode(journal).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) } catch { message = "Sync changes could not be saved. Check free storage." } }
    static let extensions: Set<String> = ["mp3","m4a","aac","wav","flac","aif","aiff","ogg","opus","webm","mp4"]
    static func digest(_ file: URL) async throws -> String {
        try await Task.detached(priority: .utility) {
            let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }; var hash = SHA256()
            while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { try Task.checkCancellation(); hash.update(data: data) }
            return hash.finalize().map { String(format: "%02x", $0) }.joined()
        }.value
    }
    func schedule() {
        guard enabled, pairing != nil else { return }
        let request = BGProcessingTaskRequest(identifier: Self.backgroundID); request.requiresNetworkConnectivity = true; request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
    private var registered = false
    func registerBackground() {
        guard !registered else { return }; registered = true
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.backgroundID, using: nil) { [weak self] task in
            let work = Task { @MainActor in guard let self else { task.setTaskCompleted(success: false); return }; await self.sync(); task.setTaskCompleted(success: !Task.isCancelled) }
            task.expirationHandler = { work.cancel() }
        }
    }
    private func discover() {
        guard pairing != nil, browser == nil, enabled else { return }
        let value = NetServiceBrowser(); value.delegate = self; value.searchForServices(ofType: "_cuda-sync._tcp.", inDomain: "local."); browser = value
    }
    nonisolated func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        Task { @MainActor in guard service.name == "Cuda-" + (pairing?.id ?? "") else { return }; service.delegate = self; resolving.append(service); service.resolve(withTimeout: 5) }
    }
    nonisolated func netServiceDidResolveAddress(_ sender: NetService) {
        Task { @MainActor in guard var value = pairing, sender.name == "Cuda-" + value.id, let host = sender.hostName, sender.port > 0 else { return }
            value.address = "https://" + host.trimmingCharacters(in: CharacterSet(charactersIn: ".")) + ":\(sender.port)"
            pairing = value; try? Keychain.write(String(data: JSONEncoder().encode(value), encoding: .utf8)!, account: "device-sync")
            await refreshPlaybackConnection()
        }
    }
}
