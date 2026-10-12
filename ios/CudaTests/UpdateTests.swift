import XCTest
@testable import Cuda

private final class UpdateProtocol: URLProtocol {
    static var status = 200
    static var body = Data()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class UpdateTests: XCTestCase {
    @MainActor
    func testUpdateCheckShowsNewIOSOnceAndKeepsManualCheckAvailable() async throws {
        let suite = "cuda-update-test-" + UUID().uuidString, defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [UpdateProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let release: [String: Any] = ["tag_name":"ios-v1.1.10","html_url":"https://github.com/veikkaheiskanen/Cuda/releases/tag/ios-v1.1.10","draft":false,"prerelease":false,"assets":[["name":"Cuda-1.1.10-ios-unsigned.ipa","size":10,"browser_download_url":"https://github.com/veikkaheiskanen/Cuda/releases/download/ios-v1.1.10/Cuda-1.1.10-ios-unsigned.ipa"]]]
        UpdateProtocol.status = 200; UpdateProtocol.body = try JSONSerialization.data(withJSONObject: [release])
        let updates = AppUpdates(defaults: defaults, session: session, version: "1.1.4")
        await updates.check(manual: false)
        XCTAssertEqual(updates.available?.version,"1.1.10"); XCTAssertEqual(updates.prompt?.version,"1.1.10"); XCTAssertNotNil(updates.lastCheck)
        updates.prompt = nil; await updates.check(manual: false); XCTAssertNil(updates.prompt)
        await updates.check(); XCTAssertNotNil(updates.prompt)
        updates.automatic = false; XCTAssertNil(updates.prompt)
        let before = updates.lastCheck; UpdateProtocol.status = 403
        await updates.check(); XCTAssertEqual(updates.lastCheck,before); XCTAssertTrue(updates.status.contains("paused")); XCTAssertFalse(updates.checking)
        UpdateProtocol.status = 200; UpdateProtocol.body = Data("[]".utf8)
        await updates.check(); XCTAssertNil(updates.available); XCTAssertTrue(updates.status.contains("up to date"))
    }
    func testPhoneUpdateNeverSelectsDesktopPrereleaseOrForeignDownloads() {
        let valid = GitHubRelease(tag_name:"ios-v1.1.5",html_url:"https://github.com/veikkaheiskanen/Cuda/releases/tag/ios-v1.1.5",draft:false,prerelease:false,assets:[.init(name:"Cuda-1.1.5-ios-unsigned.ipa",browser_download_url:"https://github.com/veikkaheiskanen/Cuda/releases/download/ios-v1.1.5/Cuda-1.1.5-ios-unsigned.ipa",size:1)])
        XCTAssertNotNil(ReleaseUpdate.latestIOS([valid],current:"1.1.4")); XCTAssertNil(ReleaseUpdate.latestIOS([valid],current:"1.1.5"))
        var bad = valid; bad.tag_name = "mac-native-v9.0.0"; XCTAssertNil(ReleaseUpdate.latestIOS([bad],current:"1.1.4"))
        bad = valid; bad.prerelease = true; XCTAssertNil(ReleaseUpdate.latestIOS([bad],current:"1.1.4"))
        bad = valid; bad.assets[0].browser_download_url = "https://evil.example/update.ipa"; XCTAssertNil(ReleaseUpdate.latestIOS([bad],current:"1.1.4"))
        XCTAssertTrue(AppVersion("1.1.10")! > AppVersion("1.1.9")!)
    }
}
