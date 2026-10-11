import Foundation

@main
struct ModelChecks {
    static func main() throws {
        let original = Track(id: "video", title: "Song", artist: "Artist", platform: "youtube", url: "https://youtube.com/watch?v=video")
        let other = Track(id: "other", title: "Other", artist: "Artist", platform: "youtube")
        let selected = Track(id: "spotify-id", title: "Song", artist: "Artist", platform: "spotify", alternatives: [original])
        let enriched = selected.withPlaybackMetadata(["duration": 256.0, "title": "Radio song", "thumbnail": "https://example.com/cover.jpg"])
        precondition(enriched.duration == 256 && enriched.title == "Radio song" && enriched.thumbnail != nil && enriched.sameRecording(original), "Spotify metadata must fill radio duration/artwork without losing source aliases")
        let queue = [original, other]
        precondition(queue.firstIndex(where: { $0.sameRecording(selected) }) == 0, "Source switching must retain queue position")
        precondition(Track.unique([original, selected]).count == 1, "Aliases must not duplicate favourites")
        var playlist = Playlist(name: "Test", tracks: [original]); playlist.add(selected)
        precondition(playlist.tracks.count == 1)
        let privateTrack = Track(id: "local", title: "Local", artist: "Artist", platform: "local", thumbnail: "http://127.0.0.1:50000/api/local-thumbnail?id=local&native_token=private")
        let saved = privateTrack.saved()
        precondition(saved.thumbnail?.contains("native_token") == false && saved.thumbnail?.contains("id=local") == true)
        let data = try JSONEncoder().encode(CollectionState(favourites: [selected, privateTrack]).saved())
        let restored = try JSONDecoder().decode(CollectionState.self, from: data)
        precondition(restored.favourites[0].sameRecording(original))
        print("PASS: queue continuity after source switching, canonical favourites/playlists, private URL stripping and Shelf round-trip")
    }
}
