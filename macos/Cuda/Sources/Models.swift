import Foundation

struct Track: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var title: String
    var artist: String
    var platform: String
    var url: String
    var duration: Double?
    var thumbnail: String?
    var localFile: String?
    var genres: [String]?
    var alternatives: [Track]?
    var albumId: String?
    var album: String?
    enum CodingKeys: String, CodingKey { case id,title,artist,platform,url,duration,thumbnail,localFile,alternatives,albumId,album,genres }
    init(id: String, title: String, artist: String, platform: String, url: String = "", duration: Double? = nil, thumbnail: String? = nil, localFile: String? = nil, alternatives: [Track]? = nil) {
        self.id=id;self.title=title;self.artist=artist;self.platform=platform;self.url=url;self.duration=duration;self.thumbnail=thumbnail;self.localFile=localFile;self.alternatives=alternatives
    }
    init(from decoder: Decoder) throws {
        let c=try decoder.container(keyedBy: CodingKeys.self)
        id=try c.decode(String.self,forKey:.id);title=try c.decodeIfPresent(String.self,forKey:.title) ?? "Untitled";artist=try c.decodeIfPresent(String.self,forKey:.artist) ?? "Unknown artist"
        platform=try c.decodeIfPresent(String.self,forKey:.platform) ?? "youtube";url=try c.decodeIfPresent(String.self,forKey:.url) ?? ""
        genres=try? c.decodeIfPresent([String].self,forKey:.genres)
        duration=try? c.decodeIfPresent(Double.self,forKey:.duration);thumbnail=try? c.decodeIfPresent(String.self,forKey:.thumbnail);localFile=try? c.decodeIfPresent(String.self,forKey:.localFile);alternatives=try? c.decodeIfPresent([Track].self,forKey:.alternatives);albumId=try? c.decodeIfPresent(String.self,forKey:.albumId);album=try? c.decodeIfPresent(String.self,forKey:.album)
    }
    var key: String { platform + ":" + id }
    var sourceName: String {
        switch platform { case "local": return "On this device"; case "spotify": return "Spotify"
        case "audius": return "Audius"; case "ytmusic": return "YouTube Music"; case "soundcloud": return "SoundCloud"; default: return "YouTube" }
    }
    func sameRecording(_ other: Track?) -> Bool {
        guard let other else { return false }
        let mine = Set([key] + (alternatives ?? []).map(\.key))
        let theirs = Set([other.key] + (other.alternatives ?? []).map(\.key))
        return !mine.isDisjoint(with: theirs)
    }
    func withPlaybackMetadata(_ metadata: [String: Any]) -> Track {
        var value = self
        if let title = metadata["title"] as? String, !title.isEmpty { value.title = title }
        if let artist = metadata["artist"] as? String, !artist.isEmpty { value.artist = artist }
        if let album = metadata["album"] as? String { value.album = album }
        if let thumbnail = metadata["thumbnail"] as? String, !thumbnail.isEmpty { value.thumbnail = thumbnail }
        if let duration = metadata["duration"] as? Double, duration.isFinite, duration > 0 { value.duration = duration }
        return value
    }
    func saved() -> Track {
        var value = self
        func clean(_ text: String) -> String {
            guard var url = URLComponents(string: text), url.host == "127.0.0.1" else { return text }
            url.queryItems = url.queryItems?.filter { $0.name != "native_token" }; return url.string ?? text
        }
        value.url = clean(url); value.thumbnail = thumbnail.map(clean); value.alternatives = alternatives?.map { $0.saved() }; return value
    }
    static func unique(_ tracks: [Track]) -> [Track] {
        var seen = Set<String>()
        return tracks.filter { track in let aliases = Set([track.key] + (track.alternatives ?? []).map(\.key)); if !seen.isDisjoint(with: aliases) { return false }; seen.formUnion(aliases); return true }
    }
}
struct Playlist: Codable, Identifiable, Equatable {
    var id = UUID().uuidString
    var name: String
    var description = ""
    var tracks: [Track] = []
    var spotifyID: String?
    var artwork: String?
    mutating func add(_ track: Track) { if !tracks.contains(where: { $0.sameRecording(track) }) { tracks.append(track) } }
}
struct CollectionState: Codable {
    var local: [Track] = []
    var favourites: [Track] = []
    var history: [Track] = []
    var playlists: [Playlist] = []
    var selectedSpotify: [String] = []
    func saved() -> CollectionState { var copy = self; copy.local = local.map { $0.saved() }; copy.favourites = favourites.map { $0.saved() }; copy.history = history.map { $0.saved() }; copy.playlists = playlists.map { var p = $0; p.tracks = p.tracks.map { $0.saved() }; return p }; return copy }
}
enum CudaError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
enum Source: String, CaseIterable, Identifiable {
    case auto, spotify, youtube, ytmusic, soundcloud, audius
    var id: String { rawValue }
    var label: String {
        switch self { case .auto: return "Auto"; case .spotify: return "Spotify"; case .youtube: return "YouTube"
        case .ytmusic: return "YouTube Music"; case .soundcloud: return "SoundCloud"; case .audius: return "Audius" }
    }
}
struct SearchResponse: Decodable { var tracks: [Track]?; var error: String? }
struct StreamInfo: Decodable { var streamUrl: String?; var proxyUrl: String?; var url: String?; var error: String? }
struct PlaybackResponse: Decodable { var track: Track?; var stream: StreamInfo?; var error: String? }

struct SpotifyAlbum: Decodable, Identifiable {
    var id: String
    var name: String
    var artists: [Artist]
    var images: [Artwork]?
    var reason: String?
    struct Artist: Decodable { var name: String }
    struct Artwork: Decodable { var url: String }
    var cover: Track { Track(id: id, title: name, artist: artists.map(\.name).joined(separator: ", "), platform: "spotify", thumbnail: images?.first?.url) }
}
struct WeeklyData: Decodable { var week: Int; var items: [SpotifyAlbum] }
struct LastFMSettings: Decodable { var username: String; var apiKey: String }
