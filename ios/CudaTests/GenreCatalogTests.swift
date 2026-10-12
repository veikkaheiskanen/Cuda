import XCTest
@testable import Cuda

private final class GenreProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let data = Data(#"{"results":[{"trackName":"Song (feat. Guest)","artistName":"Artist","primaryGenreName":"Pop"}]}"#.utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class GenreCatalogTests: XCTestCase {
    func testFeaturedCreditsMatchWithoutClassifyingRemixesOrOtherArtists() async throws {
        let suite = "cuda-genre-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [GenreProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let catalog = GenreCatalog(defaults: defaults, session: session, spacing: 0, country: "FI")
        func song(_ title: String, _ artist: String = "Artist, Guest") -> Track {
            Track(id: title + artist, title: title, artist: artist, platform: "spotify", url: "")
        }
        let short = await catalog.enrich(song("Song"))
        XCTAssertEqual(short.genres, ["pop"])
        let full = await catalog.enrich(song("Song [ft. Guest]"))
        XCTAssertEqual(full.genres, ["pop"])
        let remix = await catalog.enrich(song("Song (Remix)"))
        XCTAssertEqual(remix.genres, [])
        let other = await catalog.enrich(song("Song", "Another Artist"))
        XCTAssertEqual(other.genres, [])
    }
}
