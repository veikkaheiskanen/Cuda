import XCTest
@testable import Cuda

final class CudaTests: XCTestCase {
    func track(_ platform: String = "youtube", id: String = "one") -> Track { Track(id: id, title: "A song", artist: "An artist", platform: platform, url: "https://example.com/song") }
    func testCanonicalIdentityPreservesDifferentSources() {
        XCTAssertEqual(Track.unique([track(), track(), track("spotify")]).count, 2)
    }
    func testPlaylistAddIsIdempotent() {
        var playlist = Playlist(name: "Rotation")
        playlist.add(track()); playlist.add(track()); playlist.add(track("spotify"))
        XCTAssertEqual(playlist.tracks.count, 2)
    }
    func testCompanionAcceptsLocalHTTPAndPublicHTTPSOnly() {
        for address in ["http://192.168.1.10:38473", "http://10.0.0.2:38473", "http://172.16.0.2", "http://cuda.local", "https://cuda.example.com"] { XCTAssertTrue(Companion.validAddress(address), address) }
        for address in ["http://example.com", "http://192.168.1.999", "http://172.32.0.1", "file:///etc/passwd", "https://user:pass@example.com", "https://example.com/?token=secret"] { XCTAssertFalse(Companion.validAddress(address), address) }
    }
    func testCollectionRoundTripPreservesDescriptionsAndLocalPaths() throws {
        var value = CollectionState(); var local = track("local"); local.localFile = "hash.m4a"
        value.local = [local]; value.playlists = [Playlist(name: "Quiet", description: "After hours", tracks: [local])]
        let decoded = try JSONDecoder().decode(CollectionState.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(decoded.playlists.first?.description, "After hours"); XCTAssertEqual(decoded.local.first?.localFile, "hash.m4a")
    }
    func testSearchDecodeAndEmptyOptionalMetadata() throws {
        let response = try JSONDecoder().decode(SearchResponse.self, from: Data(#"{"tracks":[{"id":"one","title":"Song","artist":"Artist","platform":"youtube","url":"https://example.com"}]}"#.utf8))
        XCTAssertEqual(response.tracks?.first?.sourceName, "YouTube")
    }
}
