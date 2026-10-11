import Foundation

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
            throw CudaError.message("Pair your Mac in Settings to use YouTube and SoundCloud.")
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
    func search(_ query: String, source: Source = .auto) async throws -> [Track] {
        let result: SearchResponse = try await request("/api/search", items: [.init(name: "q", value: query), .init(name: "platform", value: source.rawValue), .init(name: "limit", value: "20")])
        return result.tracks ?? []
    }
    func stream(_ track: Track, source: Source, excluded: [String] = []) async throws -> (Track, URL) {
        if source == .auto {
            // Exclude Mac-native Spotify: its audio is played locally by the official iOS SDK.
            let body = try JSONSerialization.data(withJSONObject: ["track": JSONSerialization.jsonObject(with: JSONEncoder().encode(track)), "exclude": excluded, "mobile": true])
            let value: PlaybackResponse = try await request("/api/playback-source", body: body)
            guard let selected = value.track, selected.platform != "spotify", let raw = value.stream?.streamUrl ?? value.stream?.url, let url = URL(string: raw) else {
                throw CudaError.message(value.error ?? "This source could not start. Choose another source and retry.")
            }
            return (selected, url)
        }
        var selected = track
        if source.rawValue != track.platform {
            let result: PlaybackResponse = try await request("/api/resolve-source", items: [.init(name: "title", value: track.title), .init(name: "artist", value: track.artist), .init(name: "source", value: source.rawValue), .init(name: "id", value: track.id), .init(name: "platform", value: track.platform), .init(name: "url", value: track.url), .init(name: "duration", value: String(track.duration ?? 0))])
            guard let match = result.track else { throw CudaError.message(result.error ?? "No matching recording on this source.") }; selected = match
        }
        let value: StreamInfo = try await request("/api/stream-info", items: [.init(name: "id", value: selected.id), .init(name: "url", value: selected.url), .init(name: "platform", value: selected.platform)])
        guard let raw = value.streamUrl ?? value.url, let url = URL(string: raw) else { throw CudaError.message(value.error ?? "No playable audio was found.") }
        return (selected, url)
    }
}
