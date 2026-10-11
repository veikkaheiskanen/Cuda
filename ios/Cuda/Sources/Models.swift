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
    var key: String { platform + ":" + id }
    var sourceName: String {
        switch platform { case "local": return "On this device"; case "spotify": return "Spotify"
        case "ytmusic": return "YouTube Music"; case "soundcloud": return "SoundCloud"; default: return "YouTube" }
    }
    static func unique(_ tracks: [Track]) -> [Track] {
        var seen = Set<String>()
        return tracks.filter { seen.insert($0.key).inserted }
    }
}
struct Playlist: Codable, Identifiable, Equatable {
    var id = UUID().uuidString
    var name: String
    var description = ""
    var tracks: [Track] = []
    var spotifyID: String?
    mutating func add(_ track: Track) { if !tracks.contains(where: { $0.key == track.key }) { tracks.append(track) } }
}
struct CollectionState: Codable {
    var local: [Track] = []
    var favourites: [Track] = []
    var history: [Track] = []
    var playlists: [Playlist] = []
    var selectedSpotify: [String] = []
}
enum CudaError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
enum Source: String, CaseIterable, Identifiable {
    case auto, spotify, youtube, ytmusic, soundcloud
    var id: String { rawValue }
    var label: String {
        switch self { case .auto: return "Auto"; case .spotify: return "Spotify"; case .youtube: return "YouTube"
        case .ytmusic: return "YouTube Music"; case .soundcloud: return "SoundCloud" }
    }
}
struct SearchResponse: Decodable { var tracks: [Track]?; var error: String? }
struct StreamInfo: Decodable { var streamUrl: String?; var url: String?; var error: String? }
struct PlaybackResponse: Decodable { var track: Track?; var stream: StreamInfo?; var error: String? }
