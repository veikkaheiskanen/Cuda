import Foundation
import UIKit
import SpotifyiOS

@MainActor
final class Spotify: NSObject, ObservableObject, SPTAppRemoteDelegate, SPTAppRemotePlayerStateDelegate {
    @Published var connected = false
    @Published var message = "Connect the Spotify app on this device."
    @Published var artwork: UIImage?
    var onState: ((Track, Bool, Double) -> Void)?
    var onAuthorized: (() -> Void)?
    private var remote: SPTAppRemote?
    private var configuredID = ""
    private var pendingURI: String?
    private var acceptsState = false
    private var authorizing = false
    private var artworkKey = ""
    private var accessToken = ""
    private var lastState: SPTAppRemotePlayerState?
    var clientID: String { UserDefaults.standard.string(forKey: "spotifyClientID") ?? "" }
    var hasToken: Bool { !accessToken.isEmpty }

    private func configure() throws -> SPTAppRemote {
        guard clientID.range(of: "^[a-fA-F0-9]{32}$", options: .regularExpression) != nil else {
            throw CudaError.message("Add your Spotify Client ID in Settings first.")
        }
        if remote == nil || configuredID != clientID {
            remote?.disconnect(); configuredID = clientID
            let configuration = SPTConfiguration(clientID: clientID, redirectURL: URL(string: "cuda-spotify://callback")!)
            remote = SPTAppRemote(configuration: configuration, logLevel: .none)
            remote?.delegate = self
        }
        return remote!
    }
    func connect(uri: String = "") throws {
        let remote = try configure()
        guard UIApplication.shared.canOpenURL(URL(string: "spotify://")!) else {
            throw CudaError.message("Install Spotify on this device and sign in, then connect again.")
        }
        acceptsState = true; authorizing = true; pendingURI = uri.isEmpty ? nil : uri
        message = "Finish connecting in Spotify…"
        remote.authorizeAndPlayURI(uri, asRadio: false, additionalScopes: ["playlist-read-private", "playlist-read-collaborative", "user-library-read", "user-library-modify"]) { [weak self] success in
            if !success { self?.message = "Spotify could not open. Install Spotify and retry."; self?.authorizing = false }
        }
    }
    func handle(_ url: URL) {
        guard url.scheme == "cuda-spotify", url.host == "callback", authorizing, let remote else { return }
        authorizing = false
        let parameters = remote.authorizationParameters(from: url)
        if let token = parameters?[SPTAppRemoteAccessTokenKey] {
            accessToken = token; remote.connectionParameters.accessToken = token
            remote.connect(); onAuthorized?()
        } else { message = parameters?[SPTAppRemoteErrorDescriptionKey] ?? "Spotify sign-in was cancelled." }
    }
    func foreground() { if !accessToken.isEmpty, acceptsState, remote?.isConnected == false { remote?.connect() } }
    func background() { remote?.disconnect() }
    func deactivate() { acceptsState = false; pendingURI = nil; remote?.playerAPI?.pause(nil); remote?.disconnect() }
    func disconnect() { deactivate(); accessToken = ""; remote = nil; connected = false; artwork = nil; message = "Disconnected." }
    func play(_ track: Track) throws {
        acceptsState = true
        let uri = "spotify:track:" + track.id
        if remote?.isConnected == true { remote?.playerAPI?.play(uri, callback: report) }
        else { try connect(uri: uri) }
    }
    func toggle(paused: Bool) throws {
        guard let api = remote?.playerAPI, connected else { try connect(uri: pendingURI ?? lastState?.track.uri ?? ""); return }
        if paused { api.resume(report) } else { api.pause(report) }
    }
    func seek(_ seconds: Double) { remote?.playerAPI?.seek(toPosition: Int(seconds * 1000), callback: report) }
    func next() { remote?.playerAPI?.skip(toNext: report) }
    func previous() { remote?.playerAPI?.skip(toPrevious: report) }
    private var report: SPTAppRemoteCallback { { [weak self] _, error in if let error { self?.message = error.localizedDescription } } }
    func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        connected = true; message = "Connected to Spotify on this device."
        appRemote.playerAPI?.delegate = self
        appRemote.playerAPI?.subscribe(toPlayerState: report)
        if let uri = pendingURI { pendingURI = nil; appRemote.playerAPI?.play(uri, callback: report) }
    }
    func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        connected = false; message = "Spotify connection stopped. Tap Connect Spotify to resume."
    }
    func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) { connected = false }
    func playerStateDidChange(_ state: SPTAppRemotePlayerState) {
        guard acceptsState else { return }; lastState = state
        let item = state.track
        let id = item.uri.split(separator: ":").last.map(String.init) ?? item.uri
        let track = Track(id: id, title: item.name, artist: item.artist.name, platform: "spotify", url: "https://open.spotify.com/track/" + id, duration: Double(item.duration) / 1000)
        onState?(track, !state.isPaused, Double(state.playbackPosition) / 1000)
        if artworkKey != item.uri {
            artworkKey = item.uri; artwork = nil
            let key = item.uri
            remote?.imageAPI?.fetchImage(forItem: item, with: CGSize(width: 640, height: 640)) { [weak self] value, _ in
                guard self?.artworkKey == key else { return }; self?.artwork = value as? UIImage
            }
        }
    }
    func api(_ path: String, method: String = "GET") async throws -> Data {
        guard !accessToken.isEmpty else { throw CudaError.message("Connect Spotify in Settings first.") }
        // Only Spotify's own API ever receives this token, including pagination.
        guard let url = URL(string: "https://api.spotify.com/v1/" + path), url.host == "api.spotify.com" else { throw CudaError.message("Invalid Spotify request.") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 20
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
            if (response as? HTTPURLResponse)?.statusCode == 401 { accessToken = ""; throw CudaError.message("Spotify sign-in expired. Connect Spotify again in Settings.") }
            throw CudaError.message("Spotify could not complete this request. Check your developer app access and try again.")
        }
        return data
    }
    func pages(_ path: String) async throws -> [[String: Any]] {
        var next: String? = path; var items: [[String: Any]] = []; var visited = Set<String>()
        while let path = next, visited.insert(path).inserted, visited.count <= 100 {
            let data = try await api(path)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            items += json["items"] as? [[String: Any]] ?? []
            next = nil
            if let raw = json["next"] as? String, let url = URLComponents(string: raw), url.scheme == "https", url.host == "api.spotify.com", url.path.hasPrefix("/v1/") {
                next = String(url.path.dropFirst(4)) + (url.percentEncodedQuery.map { "?" + $0 } ?? "")
            }
        }
        return items
    }
    static func track(_ json: [String: Any]) -> Track? {
        guard let id = json["id"] as? String, let title = json["name"] as? String, json["type"] as? String == "track", json["is_local"] as? Bool != true else { return nil }
        let artists = (json["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }.joined(separator: ", ")
        let album = json["album"] as? [String: Any] ?? [:]
        let image = (album["images"] as? [[String: Any]])?.first?["url"] as? String
        return Track(id: id, title: title, artist: artists, platform: "spotify", url: "https://open.spotify.com/track/" + id, duration: (json["duration_ms"] as? Double).map { $0 / 1000 }, thumbnail: image)
    }
    func search(_ query: String) async throws -> [Track] {
        var c = URLComponents(); c.queryItems = [.init(name: "q", value: query), .init(name: "type", value: "track"), .init(name: "limit", value: "10")]
        let data = try await api("search?" + (c.percentEncodedQuery ?? ""))
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return ((json?["tracks"] as? [String: Any])?["items"] as? [[String: Any]] ?? []).compactMap(Self.track)
    }
    func playlists() async throws -> [Playlist] {
        try await pages("me/playlists?limit=50").compactMap { item in
            guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
            return Playlist(id: "spotify:" + id, name: name, description: item["description"] as? String ?? "Spotify playlist", spotifyID: id)
        }
    }
    func playlistTracks(_ id: String) async throws -> [Track] {
        guard id.range(of: "^[a-zA-Z0-9]{22}$", options: .regularExpression) != nil else { throw CudaError.message("Invalid Spotify playlist.") }
        return Track.unique(try await pages("playlists/" + id + "/items?limit=50").compactMap { Self.track($0["item"] as? [String: Any] ?? $0["track"] as? [String: Any] ?? [:]) })
    }
    func like(_ track: Track, liked: Bool) async throws {
        guard track.platform == "spotify", track.id.range(of: "^[a-zA-Z0-9]{22}$", options: .regularExpression) != nil else { return }
        _ = try await api("me/library?uris=spotify%3Atrack%3A" + track.id, method: liked ? "PUT" : "DELETE")
    }
}
