import XCTest
@testable import Cuda

final class StreamingTests: XCTestCase {
    @MainActor
    func testChoicesPersistOnThisDeviceAndNeverDisableLocalFiles() throws {
        let suite = "cuda-services-test-" + UUID().uuidString, defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let choices = StreamingPreferences(defaults: defaults)
        XCTAssertFalse(choices.allows("audius")); XCTAssertTrue(choices.allows("spotify"))
        for name in StreamingPreferences.services { choices.set(name, enabled: false) }
        XCTAssertTrue(choices.allows("local")); XCTAssertTrue(choices.enabled.isEmpty)
        XCTAssertTrue(StreamingPreferences(defaults: defaults).enabled.isEmpty)
        choices.set("audius", enabled: true); choices.set("unknown", enabled: true)
        XCTAssertEqual(StreamingPreferences(defaults: defaults).enabled, ["audius"])
    }
    func testGenreMetadataAndAudiusSurviveShelfRoundTrip() throws {
        var song = Track(id: "fixture", title: "Song", artist: "Artist", platform: "audius", url: "https://audius.co/artist/song")
        song.genres = ["hip hop"]
        let decoded = try JSONDecoder().decode(Track.self, from: JSONEncoder().encode(song))
        XCTAssertEqual(decoded.genres, song.genres); XCTAssertEqual(decoded.sourceName, "Audius")
        XCTAssertEqual(ShelfSyncJournal.clean(decoded).genres, song.genres)
    }
}
