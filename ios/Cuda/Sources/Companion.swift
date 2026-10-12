import Foundation

struct PairedCompanion: Codable {
    var macID: String
    var address: String
    var token: String
    var connection: Companion { Companion(address: address, token: token) }
}
struct CompanionSetup: Decodable {
    var service: String
    var version: Int
    var port: Int
    var token: String
    var error: String?
    func connection(address: String, macID: String) throws -> PairedCompanion {
        guard service == "cuda-ios-companion", version == 1, (1...65535).contains(port),
              token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              var url = URLComponents(string: address), url.scheme == "https", url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty, UUID(uuidString: macID) != nil else {
            throw CudaError.message(error?.isEmpty == false ? error! : "Reopen Cuda on your Mac to start its streaming companion.")
        }
        url.scheme = "http"; url.port = port
        guard let origin = url.string, Companion.validAddress(origin) else { throw CudaError.message("The streaming companion must use the paired Mac’s local address.") }
        return PairedCompanion(macID: macID, address: origin, token: token)
    }
}

struct Companion {
    var address: String
    var token: String
    static func validAddress(_ text: String) -> Bool {
        guard let u = URLComponents(string: text), let host = u.host, u.user == nil, u.password == nil,
              u.query == nil, u.fragment == nil, u.path.isEmpty || u.path == "/" else { return false }
        if u.scheme == "https" { return true }
        guard u.scheme == "http" else { return false }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        let privateIP = parts.count == 4 && parts.allSatisfy { (0...255).contains($0) } &&
            (parts[0] == 10 || (parts[0] == 172 && (16...31).contains(parts[1])) || (parts[0] == 192 && parts[1] == 168) || parts[0] == 127)
        return privateIP || host.hasSuffix(".local") || host == "localhost"
    }
    func endpoint(_ path: String, items: [URLQueryItem] = []) throws -> URL {
        guard Self.validAddress(address), !token.isEmpty, var url = URLComponents(string: address) else {
            throw CudaError.message("Open Cuda on your paired Mac and connect to the same Wi-Fi. Set up Device sync in Settings if needed.")
        }
        url.path = path; url.queryItems = items.isEmpty ? nil : items
        guard let result = url.url else { throw CudaError.message("Enter a valid companion address.") }
        return result
    }
    func request<T: Decodable>(_ path: String, items: [URLQueryItem] = [], body: Data? = nil) async throws -> T {
        var req = URLRequest(url: try endpoint(path, items: items)); req.timeoutInterval = 45
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if let body { req.httpMethod = "POST"; req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
            if let failure = try? JSONDecoder().decode(SearchResponse.self, from: data), let message = failure.error { throw CudaError.message(message) }
            throw CudaError.message("The Mac companion is unavailable. Check the address, pairing key, and that Cuda is open.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    @MainActor
    private var serviceItems: [URLQueryItem] { [.init(name: "services", value: StreamingPreferences.shared.enabled.joined(separator: ","))] }
    @MainActor
    func recommendations(history: [Track], favourites: [Track], playlists: [Track], genre: String, seen: [String]) async throws -> RecommendationResponse {
        let body = try JSONSerialization.data(withJSONObject: ["history": JSONSerialization.jsonObject(with: JSONEncoder().encode(history)), "favorites": JSONSerialization.jsonObject(with: JSONEncoder().encode(favourites)), "playlists": JSONSerialization.jsonObject(with: JSONEncoder().encode(playlists)), "genre": genre, "seen": seen, "services": StreamingPreferences.shared.enabled, "limit": 20])
        return try await request("/api/vibe", body: body)
    }
    @MainActor
    func search(_ query: String, source: Source = .auto) async throws -> [Track] {
        let result: SearchResponse = try await request("/api/search", items: [.init(name: "q", value: query), .init(name: "platform", value: source.rawValue), .init(name: "limit", value: "20")] + serviceItems)
        return result.tracks ?? []
    }
    @MainActor
    func stream(_ track: Track, source: Source, excluded: [String] = []) async throws -> (Track, URL) {
        if source == .auto {
            // Exclude Mac-native Spotify: its audio is played locally by the official iOS SDK.
            let body = try JSONSerialization.data(withJSONObject: ["track": JSONSerialization.jsonObject(with: JSONEncoder().encode(track)), "exclude": excluded, "mobile": true, "services": StreamingPreferences.shared.enabled])
            let value: PlaybackResponse = try await request("/api/playback-source", body: body)
            guard let selected = value.track, selected.platform != "spotify", let raw = value.stream?.proxyUrl ?? value.stream?.streamUrl ?? value.stream?.url, let url = URL(string: raw) else {
                throw CudaError.message(value.error ?? "This source could not start. Choose another source and retry.")
            }
            return (selected, url)
        }
        var selected = track
        if source.rawValue != track.platform {
            let result: PlaybackResponse = try await request("/api/resolve-source", items: [.init(name: "title", value: track.title), .init(name: "artist", value: track.artist), .init(name: "source", value: source.rawValue), .init(name: "id", value: track.id), .init(name: "platform", value: track.platform), .init(name: "url", value: track.url), .init(name: "duration", value: String(track.duration ?? 0))] + serviceItems)
            guard let match = result.track else { throw CudaError.message(result.error ?? "No matching recording on this source.") }; selected = match
        }
        let value: StreamInfo = try await request("/api/stream-info", items: [.init(name: "id", value: selected.id), .init(name: "url", value: selected.url), .init(name: "platform", value: selected.platform)] + serviceItems)
        guard let raw = value.proxyUrl ?? value.streamUrl ?? value.url, let url = URL(string: raw) else { throw CudaError.message(value.error ?? "No playable audio was found.") }
        return (selected, url)
    }
}
