import XCTest
@testable import Cuda

final class CudaTests: XCTestCase {
    func track(_ platform: String = "youtube", id: String = "one") -> Track { Track(id: id, title: "A song", artist: "An artist", platform: platform, url: "https://example.com/song") }
    func testSyncPairingRequiresPinnedTLSAndLocalAddress() throws {
        let key = String(repeating: "a", count: 64), cert = String(repeating: "b", count: 64), id = UUID().uuidString
        func link(_ address: String) -> String { var u = URLComponents(); u.scheme = "cuda-sync"; u.host = "pair"; u.queryItems = [.init(name: "address", value: address), .init(name: "key", value: key), .init(name: "cert", value: cert), .init(name: "id", value: id)]; return u.string! }
        XCTAssertEqual(try SyncPairing.parse(link("https://192.168.1.10:38474")).fingerprint, cert)
        XCTAssertThrowsError(try SyncPairing.parse(link("http://192.168.1.10:38474")))
        XCTAssertThrowsError(try SyncPairing.parse(link("https://example.com:38474")))
        XCTAssertThrowsError(try SyncPairing.parse(link("https://user:secret@cuda.local:38474")))
        XCTAssertThrowsError(try SyncPairing.parse("cuda-sync://pair?address=https://cuda.local"))
    }
    func testSyncRemovalsPersistAndLocalPlaybackPathsStayPrivate() throws {
        var mac = ShelfSyncJournal(), phone = ShelfSyncJournal(); var a = CollectionState(), b = CollectionState()
        a.favourites = [track("spotify")]; a.playlists = [Playlist(id: "rotation", name: "Rotation", tracks: a.favourites)]; mac.capture(a)
        phone.merge(Array(mac.records.values)); phone.apply(to: &b); XCTAssertEqual(b.favourites.count, 1)
        b.favourites = []; b.playlists = []; phone.capture(b); mac.merge(Array(phone.records.values)); mac.apply(to: &a)
        XCTAssertTrue(a.favourites.isEmpty); XCTAssertTrue(a.playlists.isEmpty)
        var local = track("local"); local.url = "file:///private/music"; local.localFile = "secret.wav"
        let safe = ShelfSyncJournal.clean(local); XCTAssertEqual(safe.url, ""); XCTAssertNil(safe.localFile)
    }
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
