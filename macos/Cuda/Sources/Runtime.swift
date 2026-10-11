import Foundation
import AppKit
import Security

@MainActor
final class Runtime: ObservableObject {
    @Published var ready = false
    @Published var port = 0
    var event: (([String: Any]) -> Void)?
    private var process: Process?
    private var input: FileHandle?
    private var buffer = Data()
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var serial = 0
    let directory: URL
    init() {
        directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["CUDA_NATIVE_PROFILE"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Riff").path)
    }
    func start() async throws -> Data {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let resources = Bundle.main.resourceURL!
        let child = Process(), stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        child.executableURL = resources.appendingPathComponent("runtime/node")
        child.arguments = [resources.appendingPathComponent("backend/macos/native-host.js").path]
        var environment = ProcessInfo.processInfo.environment
        environment["RIFF_DATA_DIR"] = directory.path
        for name in ["yt-dlp", "ffmpeg", "ffprobe", "riff-spotify-player"] {
            environment["RIFF_" + name.filter { $0.isLetter || $0.isNumber }.uppercased()] = resources.appendingPathComponent("tools/bin/" + name).path
        }
        child.environment = environment; child.standardInput = stdin; child.standardOutput = stdout; child.standardError = stderr
        input = stdin.fileHandleForWriting
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor in self?.consume(data) }
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        child.terminationHandler = { [weak self] _ in Task { @MainActor in self?.stopped() } }
        let key = try NativeKey.key(ephemeral: ProcessInfo.processInfo.environment["CUDA_NATIVE_PROFILE"] != nil)
        try child.run(); process = child
        let data = try await call("init", ["key": key.base64EncodedString()])
        let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        port = value?["port"] as? Int ?? 0; ready = port > 0
        guard ready else { throw CudaError.message("The music service could not start. Reopen Cuda.") }
        return data
    }
    func call(_ method: String, _ args: [String: Any] = [:]) async throws -> Data {
        guard let input else { throw CudaError.message("Cuda is starting. Try again in a moment.") }
        serial += 1; let id = serial
        var data = try JSONSerialization.data(withJSONObject: ["id": id, "method": method, "args": args]); data.append(10)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            do { try input.write(contentsOf: data) } catch { pending.removeValue(forKey: id)?.resume(throwing: error) }
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(method == "spotify" ? 240 : 50))
                self?.pending.removeValue(forKey: id)?.resume(throwing: CudaError.message("The music service took too long. Retry or choose another source."))
            }
        }
    }
    func api<T: Decodable>(_ path: String, body: [String: Any]? = nil) async throws -> T {
        var args: [String: Any] = ["path": path]; if let body { args["body"] = body }
        return try JSONDecoder().decode(T.self, from: await call("api", args))
    }
    func spotify<T: Decodable>(_ operation: String, _ values: [Any] = []) async throws -> T {
        try JSONDecoder().decode(T.self, from: await call("spotify", ["operation": operation, "values": values]))
    }
    func spotifyVoid(_ operation: String, _ values: [Any] = []) async throws { _ = try await call("spotify", ["operation": operation, "values": values]) }
    func url(_ path: String) -> URL { URL(string: "http://127.0.0.1:\(port)" + path)! }
    private func consume(_ data: Data) {
        buffer.append(data)
        guard buffer.count < 64_000_000 else { stop(); return }
        while let index = buffer.firstIndex(of: 10) {
            let line = Data(buffer.prefix(upTo: index)); buffer.removeSubrange(...index)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if let id = value["id"] as? Int, let waiter = pending.removeValue(forKey: id) {
                if let error = value["error"] as? String { waiter.resume(throwing: CudaError.message(error)) }
                else { waiter.resume(returning: (try? JSONSerialization.data(withJSONObject: value["data"] ?? [:], options: [.fragmentsAllowed])) ?? Data("{}".utf8)) }
            } else if value["event"] as? String == "openURL", let raw = value["url"] as? String, let url = URL(string: raw), url.scheme == "https", url.host == "accounts.spotify.com" {
                NSWorkspace.shared.open(url)
            } else { event?(value) }
        }
    }
    func stop() { try? input?.close(); input = nil; process?.terminate(); process = nil; stopped() }
    private func stopped() {
        ready = false
        for waiter in pending.values { waiter.resume(throwing: CudaError.message("The music service stopped. Reopen Cuda.")) }; pending.removeAll()
    }
}
enum NativeKey {
    static func key(ephemeral: Bool = false) throws -> Data {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.veikkaheiskanen.Cuda.native", kSecAttrAccount as String: "account-encryption"]
        if !ephemeral {
            var result: CFTypeRef?
            let status = SecItemCopyMatching((query.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { _, new in new }) as CFDictionary, &result)
            if status == errSecSuccess, let data = result as? Data, data.count == 32 { return data }
            guard status == errSecItemNotFound else { throw CudaError.message("Unlock your login Keychain and reopen Cuda.") }
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw CudaError.message("Could not create account encryption key.") }
        let data = Data(bytes)
        if !ephemeral {
            let status = SecItemAdd(query.merging([kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]) { _, new in new } as CFDictionary, nil)
            guard status == errSecSuccess else { throw CudaError.message("Your Keychain could not save Cuda’s account key.") }
        }
        return data
    }
}
struct SpotifyStatus: Decodable {
    var connected: Bool = false
    var playbackConnected: Bool = false
    var clientId: String = ""
    var tracks: [Track] = []
    var selected: [String] = []
    var nativeAvailable: Bool = false
    var weekly: WeeklyData?
    var lastfm: LastFMSettings?
}
struct SpotifyChoice: Decodable, Identifiable { var id: String; var name: String; var owner: String?; var accessible: Bool?; var selected: Bool? }
