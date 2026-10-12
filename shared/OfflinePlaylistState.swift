import Foundation

// A device-private catalogue, deliberately excluded from CollectionState/Shelf sync.
struct OfflinePlaylistState: Codable {
    var files: [String: String] = [:]
    var playlists: [String: [String]] = [:]
    func available(_ track: Track, root: URL) -> URL? {
        guard let filename = files[track.key], filename.range(of: "^[a-f0-9]{64}\\.(m4a|mp3|wav)$", options: .regularExpression) != nil else { return nil }
        let url = root.appendingPathComponent(filename)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    func count(_ playlist: Playlist, root: URL) -> Int { playlist.tracks.filter { $0.platform == "local" || available($0, root: root) != nil }.count }
}
