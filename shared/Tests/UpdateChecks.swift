import Foundation
@main struct UpdateChecks {
    static func main() throws {
        func release(_ version: String, tag: String? = nil, prerelease: Bool = false, host: String = "github.com") -> GitHubRelease {
            let tag = tag ?? "ios-v" + version, name = "Cuda-\(version)-ios-unsigned.ipa"
            return GitHubRelease(tag_name: tag, html_url: "https://\(host)/veikkaheiskanen/Cuda/releases/tag/\(tag)", draft: false, prerelease: prerelease, assets: [.init(name: name, browser_download_url: "https://\(host)/veikkaheiskanen/Cuda/releases/download/\(tag)/\(name)", size: 1)])
        }
        precondition(AppVersion("1.1.10")! > AppVersion("1.1.9")!)
        precondition(AppVersion("1.0.0-beta") == nil && AppVersion("1.0") == nil)
        let values = [release("1.1.4"), release("1.1.10"),release("41.0.8", tag:"mac-native-v41.0.8"),release("9.0.0",prerelease:true),release("8.0.0",host:"evil.example")]
        precondition(ReleaseUpdate.latestIOS(values,current:"1.1.3")?.version == "1.1.10")
        precondition(ReleaseUpdate.latestIOS(values,current:"1.1.10") == nil)
        var wrong = release("1.1.11"); wrong.assets[0].browser_download_url = "https://github.com/another/repo/releases/download/ios-v1.1.11/Cuda-1.1.11-ios-unsigned.ipa"
        precondition(ReleaseUpdate.latestIOS([wrong],current:"1.1.3") == nil)
        print("PASS: numeric versions, platform isolation, stable releases, canonical download origins and no downgrade")
    }
}
