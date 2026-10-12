import Foundation

// Separate from Shelf metadata: this snapshot is transported only over pinned TLS
// and saved in Keychain. The Mac retains all OAuth refresh/playback credentials.
struct IntegrationSetup: Codable {
    struct SpotifyAccount: Codable {
        var clientID: String
        var connected: Bool
        var accessToken: String
        var expiresAt: Double
        var scope: String
        var account: String
        var message: String?
        var usable: Bool { connected && !accessToken.isEmpty && expiresAt > Date().timeIntervalSince1970 * 1000 + 30_000 }
    }
    struct LastFM: Codable { var username: String; var apiKey: String }
    var version: Int
    var macID: String
    var spotify: SpotifyAccount
    var lyrics: [String: String]
    var lastfm: LastFM
    func validate(for id: String) throws {
        guard version == 1, macID == id,
              spotify.clientID.isEmpty || spotify.clientID.range(of: "^[a-fA-F0-9]{32}$", options: .regularExpression) != nil,
              spotify.accessToken.count <= 8_000, spotify.scope.count <= 2_000, spotify.account.count <= 300,
              spotify.expiresAt.isFinite,
              Set(lyrics.keys).isSubset(of: ["musixmatch", "lyricfindSearch", "lyricfindDisplay", "genius", "territory"]),
              lyrics.values.allSatisfy({ $0.count <= 1024 }), lastfm.apiKey.count <= 100, lastfm.username.count <= 100 else {
            throw CudaError.message("Invalid account setup from your Mac.")
        }
    }
}
