import Foundation
@main struct SyncChecks {
    static func main() throws {
        let song = Track(id: "song", title: "Original fixture", artist: "Cuda Sessions", platform: "spotify", url: "https://open.spotify.com/track/song")
        var mac = ShelfSyncJournal(), phone = ShelfSyncJournal(); var m = CollectionState(), p = CollectionState()
        m.favourites = [song]; m.playlists = [Playlist(id: "rotation", name: "Rotation", description: "Fixture", tracks: [song])]; mac.capture(m)
        phone.capture(p); phone.merge(Array(mac.records.values)); phone.apply(to: &p)
        precondition(p.favourites == [song] && p.playlists.count == 1)
        p.favourites = []; p.playlists[0].name = "Edited on phone"; phone.capture(p)
        mac.merge(Array(phone.records.values)); mac.apply(to: &m); precondition(m.favourites.isEmpty && m.playlists[0].name == "Edited on phone")
        var restored = try JSONDecoder().decode(ShelfSyncJournal.self, from: JSONEncoder().encode(mac)); restored.capture(m)
        restored.merge(Array(phone.records.values)); restored.apply(to: &m); precondition(m.favourites.isEmpty)
        p.playlists = []; phone.capture(p); restored.merge(Array(phone.records.values)); restored.apply(to: &m); precondition(m.playlists.isEmpty)
        var local = Track(id: "local_123456789abc", title: "Fixture", artist: "Cuda", platform: "local", url: "file:///private/music", thumbnail: "http://127.0.0.1:44/api/art?native_token=secret", localFile: "local_123456789abc.wav")
        let clean = ShelfSyncJournal.clean(local); precondition(clean.url.isEmpty && clean.thumbnail == nil && clean.localFile == nil)
        local.url = ""; m.local = [local]; m.favourites = [local]; restored.capture(m); restored.apply(to: &m); precondition(m.favourites[0].localFile == local.localFile)
        print("PASS: two-way favourites, playlist edits/removals, restart persistence and local audio mapping")
    }
}
