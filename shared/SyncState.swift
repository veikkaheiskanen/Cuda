import Foundation

struct ShelfSyncRecord: Codable, Equatable {
    var key: String
    var clock: Int64
    var device: String
    var deleted: Bool
    var track: Track?
    var playlist: Playlist?
}
struct ShelfSyncAsset: Codable {
    var hash: String
    var filename: String
    var size: Int64
    var track: Track
}
struct ShelfSyncEnvelope: Codable {
    var records: [ShelfSyncRecord]
    var assets: [ShelfSyncAsset] = []
    var offline: Bool?
}
struct ShelfSyncJournal: Codable {
    var device = UUID().uuidString
    var records: [String: ShelfSyncRecord] = [:]
    private var clock: Int64 = 0
    private var baseline: [String: ShelfSyncRecord] = [:]
    mutating func capture(_ state: CollectionState) {
        var current: [String: ShelfSyncRecord] = [:]
        for track in state.favourites { let t = Self.clean(track); let key = "f:" + t.key; current[key] = ShelfSyncRecord(key: key, clock: 0, device: device, deleted: false, track: t) }
        for var playlist in state.playlists {
            if let id = playlist.spotifyID { playlist.id = "spotify-" + id }
            playlist.tracks = playlist.tracks.map(Self.clean)
            let key = "p:" + playlist.id; current[key] = ShelfSyncRecord(key: key, clock: 0, device: device, deleted: false, playlist: playlist)
        }
        for key in Set(current.keys).union(baseline.keys) {
            let old = baseline[key], value = current[key]
            if old?.track == value?.track && old?.playlist == value?.playlist { continue }
            clock = max(clock + 1, Int64(Date().timeIntervalSince1970 * 1000))
            var entry = value ?? ShelfSyncRecord(key: key, clock: clock, device: device, deleted: true)
            entry.clock = clock; entry.device = device; records[key] = entry
        }
        baseline = current
    }
    mutating func merge(_ incoming: [ShelfSyncRecord]) {
        for record in incoming {
            clock = max(clock, record.clock)
            if let old = records[record.key], old.clock > record.clock || old.clock == record.clock && old.device >= record.device { continue }
            records[record.key] = record
        }
    }
    mutating func apply(to state: inout CollectionState) {
        let active = records.values.filter { !$0.deleted }.sorted { $0.clock > $1.clock || $0.clock == $1.clock && $0.key < $1.key }
        func local(_ track: Track) -> Track {
            guard track.platform == "local" else { return track }
            var copy = track; copy.localFile = state.local.first { $0.key == track.key }?.localFile; return copy
        }
        state.favourites = Track.unique(active.compactMap { $0.track }.map(local))
        state.playlists = active.compactMap { $0.playlist }.map { var p = $0; p.tracks = p.tracks.map(local); return p }
        baseline = [:]
        for record in active { var value = record; value.clock = 0; value.device = device; baseline[record.key] = value }
    }
    static func clean(_ track: Track) -> Track {
        var value = track; value.localFile = nil
        if value.platform == "local" { value.url = "" }
        for key in ["url", "thumbnail"] {
            let raw = key == "url" ? value.url : value.thumbnail ?? ""
            if let u = URL(string: raw), u.isFileURL || ["127.0.0.1", "localhost"].contains(u.host ?? "") || URLComponents(string: raw)?.queryItems?.contains(where: { ["native_token", "pair", "token"].contains($0.name) }) == true {
                if key == "url" { value.url = "" } else { value.thumbnail = nil }
            }
        }
        value.alternatives = value.alternatives?.map(clean); return value
    }
}
