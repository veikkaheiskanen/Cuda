import XCTest
@testable import Cuda

private final class CompanionChoicesProtocol: URLProtocol {
    static var old = true
    static var paths: [String] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path; Self.paths.append(path)
        let status = Self.old ? 404 : 200
        let json = path == "/api/vibe" ? "{\"genres\":[],\"genre\":\"all\",\"tracks\":[]}" : "{\"tracks\":[]}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class CompanionChoicesTests: XCTestCase {
    @MainActor
    func testOldMacCannotIgnoreOptOutAndNewMacNegotiatesWithoutProviderRequests() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CompanionChoicesProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let companion = Companion(address: "http://127.0.0.1:38472", token: "fixture", session: session, serviceChoices: ["youtube"])
        CompanionChoicesProtocol.old = true; CompanionChoicesProtocol.paths = []
        do { _ = try await companion.search("Fixture"); XCTFail("An old Mac accepted the opt-out") }
        catch { XCTAssertTrue(error.localizedDescription.contains("1.0.9")) }
        XCTAssertEqual(CompanionChoicesProtocol.paths,["/api/vibe"])
        CompanionChoicesProtocol.old = false; CompanionChoicesProtocol.paths = []
        let result = try await companion.search("Fixture")
        XCTAssertTrue(result.isEmpty); XCTAssertEqual(CompanionChoicesProtocol.paths,["/api/vibe","/api/search"])
    }
}
