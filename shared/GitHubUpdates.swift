import Foundation

struct AppVersion: Comparable, Equatable {
    let components: [Int]
    init?(_ value: String) {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var values: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.allSatisfy({ $0.isASCII && $0.isNumber }), part.count <= 6, let number = Int(part) else { return nil }
            values.append(number)
        }
        components = values
    }
    static func < (lhs: Self, rhs: Self) -> Bool { lhs.components.lexicographicallyPrecedes(rhs.components) }
}
struct GitHubRelease: Decodable {
    struct Asset: Decodable {
        var name: String
        var browser_download_url: String
        var size: Int64
    }
    var tag_name: String
    var html_url: String
    var draft: Bool
    var prerelease: Bool
    var assets: [Asset]
}
struct ReleaseUpdate: Equatable, Identifiable {
    var version: String
    var releaseURL: URL
    var downloadURL: URL
    var id: String { version }
    static func latestIOS(_ releases: [GitHubRelease], current: String) -> Self? {
        guard let installed = AppVersion(current) else { return nil }
        return releases.compactMap { release -> Self? in
            guard !release.draft, !release.prerelease, release.tag_name.hasPrefix("ios-v") else { return nil }
            let version = String(release.tag_name.dropFirst(5))
            guard let parsed = AppVersion(version), parsed > installed,
                  let page = URL(string: release.html_url), safe(page, path: "/veikkaheiskanen/Cuda/releases/tag/" + release.tag_name) else { return nil }
            let name = "Cuda-\(version)-ios-unsigned.ipa"
            guard let asset = release.assets.first(where: { $0.name == name && $0.size > 0 }),
                  let download = URL(string: asset.browser_download_url), safe(download, path: "/veikkaheiskanen/Cuda/releases/download/" + release.tag_name + "/" + name) else { return nil }
            return Self(version: version, releaseURL: page, downloadURL: download)
        }.max { AppVersion($0.version)! < AppVersion($1.version)! }
    }
    private static func safe(_ url: URL, path: String) -> Bool {
        url.scheme == "https" && url.host == "github.com" && url.port == nil && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil && url.path == path
    }
}
