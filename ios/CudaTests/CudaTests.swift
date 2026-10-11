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
    func testPinnedSyncExchangesShelfAndVerifiesOfflineAudio() async throws {
        struct Fixture: Decodable { var link: String? }
        guard let url = Bundle(for: CudaTests.self).url(forResource: "SyncFixture", withExtension: "json"),
              let link = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).link else { throw XCTSkip("Start the isolated sync fixture to test a real TLS connection.") }
        let pairing = try SyncPairing.parse(link), connection = SyncConnection(pairing)
        defer { connection.session.invalidateAndCancel() }
        let health = try await connection.health(); XCTAssertEqual(health, pairing.id)
        let result = try await connection.exchange([])
        XCTAssertTrue(result.records.contains { $0.key == "p:sync-fixture" })
        let asset = try XCTUnwrap(result.assets.first)
        let (temp, response) = try await connection.session.download(for: connection.request("/sync/files/" + asset.hash))
        defer { try? FileManager.default.removeItem(at: temp) }
        try connection.validate(response)
        let digest = try await DeviceSync.digest(temp); XCTAssertEqual(digest, asset.hash)
        var upload = try connection.request("/sync/files/" + asset.hash + "?ext=wav", method: "PUT")
        upload.setValue(String(asset.size), forHTTPHeaderField: "Content-Length")
        upload.setValue(try JSONEncoder().encode(asset.track).base64EncodedString(), forHTTPHeaderField: "X-Cuda-Track")
        let (_, uploaded) = try await connection.session.upload(for: upload, fromFile: temp); try connection.validate(uploaded)
        let changed = ShelfSyncRecord(key: "p:phone-fixture", clock: Int64(Date().timeIntervalSince1970 * 1000), device: "phone-fixture", deleted: false, playlist: Playlist(id: "phone-fixture", name: "Phone fixture", tracks: [asset.track]))
        let merged = try await connection.exchange([changed]); XCTAssertTrue(merged.records.contains { $0.key == changed.key }); XCTAssertEqual(merged.assets.count, 1)
        var wrong = pairing; wrong.fingerprint = String(repeating: "0", count: 64)
        let rejected = SyncConnection(wrong); defer { rejected.session.invalidateAndCancel() }
        do { _ = try await rejected.health(); XCTFail("Accepted an unpaired certificate") } catch { }
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
