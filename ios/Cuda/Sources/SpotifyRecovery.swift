import Foundation

enum SpotifyRecovery {
    static var bundleID: String { Bundle.main.bundleIdentifier ?? "com.veikkaheiskanen.Cuda" }
    static let redirectURI = "cuda-spotify://callback"
    static func authorization(_ reason: String) -> String {
        let value = reason.lowercased()
        if value.contains("cancel") || value.contains("denied") { return "Spotify permission was cancelled. Tap Connect Spotify in Settings to try again." }
        return "Spotify could not authorize this iPhone. In your Spotify developer app, add the installed bundle ID \(bundleID) and redirect URI \(redirectURI), then tap Connect Spotify. Make sure this Spotify account has access to the developer app and Premium."
    }
    static func connection(_ error: Error?) -> String {
        let ns = error as NSError?
        let diagnostic = ns.map { " (code \($0.code))" } ?? ""
        return "Spotify did not connect on this iPhone\(diagnostic). Open Spotify, confirm you are signed in with Premium, then reconnect in Cuda Settings. If it still fails, check the iOS bundle ID and callback in your Spotify developer app."
    }
}
