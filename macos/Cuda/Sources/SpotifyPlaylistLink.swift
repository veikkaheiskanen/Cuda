import Foundation

enum SpotifyPlaylistLink {
    static func id(_ input: String) -> String? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        func valid(_ id: String) -> Bool { id.range(of: "^[A-Za-z0-9]{22}$", options: .regularExpression) != nil }
        if valid(value) { return value }
        if value.hasPrefix("spotify:playlist:") { let id = String(value.dropFirst("spotify:playlist:".count)); return valid(id) ? id : nil }
        guard let url = URLComponents(string: value), url.scheme == "https", url.host == "open.spotify.com", url.user == nil, url.password == nil else { return nil }
        let parts = url.path.split(separator: "/")
        guard let index = parts.firstIndex(of: "playlist"), index + 2 == parts.count, index == 0 || index == 1 && parts[0].hasPrefix("intl-") else { return nil }
        let id = String(parts[index + 1]); return valid(id) ? id : nil
    }
}
