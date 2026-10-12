import Foundation

// On an unpaired phone, classify exact catalogue matches without guessing
// from artwork, filenames or the listener's location. No preview audio is used.
actor GenreCatalog {
    static let shared = GenreCatalog()
    private var nextRequest = Date.distantPast
    private var cache: [String: Entry] = [:]
    private let defaults: UserDefaults
    private let session: URLSession
    private let country: String
    private let spacing: TimeInterval
    private struct Entry: Codable { var genres: [String]; var expires: Date }
    init(defaults: UserDefaults = .standard, session: URLSession = .shared, spacing: TimeInterval = 3.1, country: String = Locale.current.region?.identifier ?? "US") {
        self.defaults = defaults; self.session = session; self.spacing = spacing; self.country = country
        if let bytes = defaults.data(forKey: "listened-genre-cache"), let saved = try? JSONDecoder().decode([String: Entry].self, from: bytes) { cache = saved }
    }
    private func normalized(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
    }
    func enrich(_ track: Track) async -> Track {
        guard (track.genres ?? []).isEmpty, track.artist != "Unknown artist" else { return track }
        let key = normalized(track.artist) + "|" + normalized(track.title) + "|" + country
        if let saved = cache[key], saved.expires > Date() { var t = track; t.genres = saved.genres; return t }
        let wait = max(0, nextRequest.timeIntervalSinceNow); nextRequest = Date().addingTimeInterval(wait + spacing)
        do {
            if wait > 0 { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }; try Task.checkCancellation()
            var url = URLComponents(string: "https://itunes.apple.com/search")!
            url.queryItems = [.init(name: "term", value: track.artist + " " + track.title), .init(name: "entity", value: "song"), .init(name: "limit", value: "5"), .init(name: "country", value: country)]
            var request = URLRequest(url: url.url!); request.timeoutInterval = 5
            let (data,response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let json = try JSONSerialization.jsonObject(with: data) as? [String: Any], let results = json["results"] as? [[String: Any]] else { return track }
            let artist = normalized(track.artist.components(separatedBy: ",").first ?? track.artist)
            let match = results.first { normalized($0["trackName"] as? String ?? "") == normalized(track.title) && normalized(($0["artistName"] as? String ?? "").components(separatedBy: ",").first ?? "") == artist }
            let raw = (match?["primaryGenreName"] as? String ?? "").lowercased()
            let name = ["hip-hop/rap": "hip hop", "r&b/soul": "r&b"][raw] ?? raw
            let genres = name.isEmpty ? [] : [name]
            cache[key] = Entry(genres: genres, expires: Date().addingTimeInterval(genres.isEmpty ? 86400 : 30 * 86400))
            if cache.count > 500 { for old in cache.sorted(by: { $0.value.expires < $1.value.expires }).prefix(cache.count - 500) { cache.removeValue(forKey: old.key) } }
            if let data = try? JSONEncoder().encode(cache) { defaults.set(data, forKey: "listened-genre-cache") }
            var value = track; value.genres = genres; return value
        } catch { return track }
    }
}
