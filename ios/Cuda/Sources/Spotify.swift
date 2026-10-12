import Foundation
import UIKit
import SpotifyiOS

@MainActor
final class Spotify: NSObject, ObservableObject, SPTAppRemoteDelegate, SPTAppRemotePlayerStateDelegate {
    @Published var connected = false
    @Published var message = "Connect the Spotify app on this device."
    @Published var artwork: UIImage?
    var onState: ((Track, Bool, Double) -> Void)?
    var onFailure: ((String) -> Void)?
    var onAuthorized: (() -> Void)?
    private var remote: SPTAppRemote?
    private var configuredID = ""
    private var pendingURI: String?
    private var acceptsState = false
    private var authorizing = false
    private var wakeURI: String?
    private var tokenExpires = Date.distantPast
    private var requestID = UUID()
    private var connectionWatchdog: Task<Void, Never>?
    private var retrying = false
    private var backgrounded = false
    private var connecting = false
    private var artworkKey = ""
    private var accessToken = ""
    private var lastState: SPTAppRemotePlayerState?
    @Published private(set) var macAccount: IntegrationSetup.SpotifyAccount?
    var clientID: String {
        let own = UserDefaults.standard.string(forKey: "spotifyClientID") ?? ""
        return own.isEmpty ? macAccount?.clientID ?? "" : own
    }
    var artworkTrackID: String { artworkKey.split(separator: ":").last.map(String.init) ?? "" }
    var hasToken: Bool { (!accessToken.isEmpty && tokenExpires > Date()) || macAccount?.usable == true }
    func applyMacSetup(_ value: IntegrationSetup.SpotifyAccount?) {
        macAccount = UserDefaults.standard.object(forKey: "sync-accounts") as? Bool == false ? nil : value
    }
    private var apiToken: String { !accessToken.isEmpty && tokenExpires > Date() ? accessToken : macAccount?.usable == true ? macAccount!.accessToken : "" }


    private func configure() throws -> SPTAppRemote {
        guard clientID.range(of: "^[a-fA-F0-9]{32}$", options: .regularExpression) != nil else {
            throw CudaError.message("Add your Spotify Client ID in Settings first.")
        }
        if remote == nil || configuredID != clientID {
            remote?.disconnect(); accessToken = ""; tokenExpires = .distantPast; configuredID = clientID
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
        connectionWatchdog?.cancel(); requestID = UUID(); retrying = false
        acceptsState = true; pendingURI = uri.isEmpty ? nil : uri
        // Mac Web API credentials remain for library access. App Remote must wake
        // and authorize the Spotify app installed on this specific phone.
        authorize(remote, uri: uri)
    }
    private func authorize(_ remote: SPTAppRemote, uri: String) {
        authorizing = true; wakeURI = uri.isEmpty ? nil : uri
        let id = requestID
        message = "Finish connecting in Spotify…"
        remote.authorizeAndPlayURI(uri, asRadio: false, additionalScopes: ["playlist-read-private", "playlist-read-collaborative", "user-library-read", "user-library-modify"]) { [weak self] success in
            Task { @MainActor in
                guard let self, self.requestID == id, self.remote === remote else { return }
                if !success { self.fail("Spotify could not open. Install Spotify and retry.") }
            }
        }
    }
    func handle(_ url: URL) {
        guard url.scheme == "cuda-spotify", url.host == "callback", authorizing, let remote else { return }
        authorizing = false
        let parameters = remote.authorizationParameters(from: url)
        if let token = parameters?[SPTAppRemoteAccessTokenKey], !token.isEmpty {
            accessToken = token; tokenExpires = Date(timeIntervalSinceNow: 3500)
            remote.connectionParameters.accessToken = token
            connectRemote(remote); onAuthorized?()
        } else {
            fail(SpotifyRecovery.authorization(parameters?[SPTAppRemoteErrorDescriptionKey] ?? ""))
        }
    }
    private func connectRemote(_ remote: SPTAppRemote) {
        if !connecting { connecting = true; remote.connect() }; connectionWatchdog?.cancel()
        let id = requestID
        connectionWatchdog = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(10)) } catch { return }
            guard let self, self.requestID == id, !self.backgrounded, !self.connected, self.acceptsState else { return }
            self.recover(nil)
        }
    }
    func foreground() {
        backgrounded = false
        guard acceptsState, !authorizing, let remote, !remote.isConnected else { return }
        if !accessToken.isEmpty, tokenExpires > Date() { connectRemote(remote) }
        else if let uri = pendingURI ?? lastState?.track.uri { retrying = true; authorize(remote, uri: uri) }
    }
    func background() { backgrounded = true; connecting = false; connectionWatchdog?.cancel(); remote?.disconnect(); connected = false }
    func deactivate() {
        acceptsState = false; authorizing = false; connecting = false; pendingURI = nil; wakeURI = nil
        requestID = UUID(); connectionWatchdog?.cancel()
        remote?.playerAPI?.pause(nil); remote?.disconnect(); connected = false
    }
    func disconnect() { deactivate(); accessToken = ""; tokenExpires = .distantPast; remote = nil; connected = false; artwork = nil; message = "Disconnected." }
    func play(_ track: Track) throws {
        guard track.id.range(of: "^[a-zA-Z0-9]{22}$", options: .regularExpression) != nil else { throw CudaError.message("This Spotify song has an invalid identifier. Search for it again.") }
        acceptsState = true; retrying = false; pendingURI = "spotify:track:" + track.id
        if authorizing { return } // A new selection replaces the pending song during app switching.
        if let remote, remote.isConnected {
            requestID = UUID(); remote.playerAPI?.play(pendingURI!, callback: report)
        } else if let remote, !accessToken.isEmpty, tokenExpires > Date() {
            requestID = UUID(); wakeURI = nil; connectRemote(remote)
        } else { try connect(uri: pendingURI!) }
    }
    func toggle(paused: Bool) throws {
        guard let api = remote?.playerAPI, connected else { try connect(uri: pendingURI ?? lastState?.track.uri ?? ""); return }
        if paused { api.resume(report) } else { api.pause(report) }
    }
    func seek(_ seconds: Double) { remote?.playerAPI?.seek(toPosition: Int(seconds * 1000), callback: report) }
    func next() { pendingURI = nil; remote?.playerAPI?.skip(toNext: report) }
    func previous() { pendingURI = nil; remote?.playerAPI?.skip(toPrevious: report) }
    private var report: SPTAppRemoteCallback {
        let id = requestID
        return { [weak self] _, error in
            guard let error else { return }
            Task { @MainActor in guard let self, self.requestID == id, self.acceptsState, !self.backgrounded else { return }; self.recover(error) }
        }
    }
    private func fail(_ value: String) {
        connectionWatchdog?.cancel(); authorizing = false; connected = false; connecting = false
        message = value; onFailure?(value)
    }
    private func recover(_ error: Error?) {
        connectionWatchdog?.cancel(); connected = false; connecting = false
        guard acceptsState, !backgrounded, !authorizing else { return }
        // One device authorization retry for a stale connection, never an app-switch loop.
        if !retrying, let remote, let uri = pendingURI ?? lastState?.track.uri {
            retrying = true; accessToken = ""; tokenExpires = .distantPast
            remote.disconnect(); requestID = UUID(); authorize(remote, uri: uri); return
        }
        fail(SpotifyRecovery.connection(error))
    }
    nonisolated func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        Task { @MainActor in self.established(appRemote) }
    }
    private func established(_ appRemote: SPTAppRemote) {
        guard appRemote === remote, acceptsState, !backgrounded else { appRemote.disconnect(); return }
        connectionWatchdog?.cancel(); connecting = false; connected = true; message = "Connected to Spotify on this device."
        appRemote.playerAPI?.delegate = self
        appRemote.playerAPI?.subscribe(toPlayerState: report)
        // AuthorizeAndPlay already started its song; don't restart it on connection.
        if let uri = pendingURI, uri != wakeURI { appRemote.playerAPI?.play(uri, callback: report) }
        wakeURI = nil
        if pendingURI != nil {
            let id = requestID
            connectionWatchdog = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(12)) } catch { return }
                guard let self, self.requestID == id, self.pendingURI != nil, !self.backgrounded else { return }
                self.recover(nil)
            }
        }
    }
    nonisolated func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        Task { @MainActor in guard appRemote === self.remote else { return }; self.recover(error) }
    }
    nonisolated func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
        Task { @MainActor in
            guard appRemote === self.remote else { return }; self.connected = false; self.connecting = false
            if let error, !self.authorizing { self.recover(error) }
        }
    }
    nonisolated func playerStateDidChange(_ state: SPTAppRemotePlayerState) {
        Task { @MainActor in self.receive(state) }
    }
    private func receive(_ state: SPTAppRemotePlayerState) {
        guard acceptsState, connected else { return }
        if let pendingURI, state.track.uri != pendingURI { return }
        connectionWatchdog?.cancel(); pendingURI = nil; lastState = state
        let item = state.track
        let id = item.uri.split(separator: ":").last.map(String.init) ?? item.uri
        let track = Track(id: id, title: item.name, artist: item.artist.name, platform: "spotify", url: "https://open.spotify.com/track/" + id, duration: Double(item.duration) / 1000)
        onState?(track, !state.isPaused, Double(state.playbackPosition) / 1000)
        if artworkKey != item.uri {
            artworkKey = item.uri; artwork = nil
            let key = item.uri
            remote?.imageAPI?.fetchImage(forItem: item, with: CGSize(width: 640, height: 640)) { [weak self] value, _ in
                Task { @MainActor in guard self?.artworkKey == key else { return }; self?.artwork = value as? UIImage }
            }
        }
    }
    func api(_ path: String, method: String = "GET") async throws -> Data {
        let requestToken = apiToken
        guard !requestToken.isEmpty else { throw CudaError.message("Reconnect to your paired Mac or connect Spotify in Settings.") }
        // Only Spotify's own API ever receives this token, including pagination.
        guard let url = URL(string: "https://api.spotify.com/v1/" + path), url.host == "api.spotify.com" else { throw CudaError.message("Invalid Spotify request.") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 20
        request.setValue("Bearer " + requestToken, forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
            if (response as? HTTPURLResponse)?.statusCode == 401 {
                if requestToken == accessToken { accessToken = "" } else { macAccount = nil }
                throw CudaError.message("Spotify authorization expired. Sync with your Mac or reconnect Spotify in Settings.")
            }
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
    func searchAvailable(_ query: String) async -> [Track] {
        guard hasToken else { return [] }
        return (try? await search(query)) ?? []
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
