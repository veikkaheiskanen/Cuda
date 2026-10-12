import Foundation
import AVFoundation
import CryptoKit

@MainActor
final class Store: ObservableObject {
    static let shared = Store()
    @Published var state = CollectionState()
    @Published var results: [Track] = []
    @Published var recommendations: [Track] = []
    @Published var searching = false
    @Published var refreshing = false
    @Published var message: String?
    @Published var spotifyChoices: [Playlist] = []
    @Published var syncing = false
    let root: URL
    let audioRoot: URL
    let spotify = Spotify()
    lazy var deviceSync = DeviceSync(store: self)
    lazy var player: Player = {
        let value = Player(spotify: spotify, localRoot: audioRoot) { [weak self] in self?.companion ?? Companion(address: "", token: "") }
        value.didPlay = { [weak self] track in self?.remember(track) }
        value.prepareCompanion = { [weak self] in
            guard let self, !UserDefaults.standard.bool(forKey: "companionManualOverride") else { return }
            await self.deviceSync.refreshPlaybackConnection()
        }
        return value
    }()
    var companion: Companion {
        if !UserDefaults.standard.bool(forKey: "companionManualOverride"), deviceSync.pairing != nil {
            return deviceSync.playback?.connection ?? Companion(address: "", token: "")
        }
        return Companion(address: UserDefaults.standard.string(forKey: "companionAddress") ?? "", token: Keychain.read("companion"))
    }
    private var searchGeneration = UUID()
    private var favouriteSync: [String: Task<Void, Never>] = [:]
    init() {
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Cuda", isDirectory: true)
        audioRoot = root.appendingPathComponent("Audio", isDirectory: true)
        do { try FileManager.default.createDirectory(at: audioRoot, withIntermediateDirectories: true) } catch { message = error.localizedDescription }
        if let data = try? Data(contentsOf: root.appendingPathComponent("shelf.json")), let decoded = try? JSONDecoder().decode(CollectionState.self, from: data) { state = decoded }
        // Migrate the initial iOS port’s full-hash IDs without losing saved references.
        func migrate(_ track: Track) -> Track { var t = track; if t.platform == "local", t.id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil { t.id = "local_" + String(t.id.prefix(12)) }; return t }
        state.local = state.local.map(migrate); state.favourites = state.favourites.map(migrate); state.history = state.history.map(migrate)
        state.playlists = state.playlists.map { var p = $0; p.tracks = p.tracks.map(migrate); if let id = p.spotifyID { p.id = "spotify-" + id }; return p }
    }
    func save() {
        do { try JSONEncoder().encode(state).write(to: root.appendingPathComponent("shelf.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); deviceSync.recordChange() }
        catch { message = "Your Shelf could not be saved. Free some device storage and try again." }
    }
    func remember(_ track: Track) {
        guard state.history.first?.key != track.key else { return }
        state.history = Array(Track.unique([track] + state.history).prefix(100)); save()
    }
    func favourite(_ track: Track) {
        let liked = !state.favourites.contains { $0.key == track.key }
        if liked { state.favourites.append(track) } else { state.favourites.removeAll { $0.key == track.key } }
        save()
        if track.platform == "spotify", spotify.hasToken {
            let previous = favouriteSync[track.key]
            favouriteSync[track.key] = Task {
                _ = await previous?.result
                do { try await spotify.like(track, liked: liked) } catch { message = "Saved on your Shelf. Spotify sync failed: " + error.localizedDescription }
            }
        }
    }
    func createPlaylist(name: String, description: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        state.playlists.append(Playlist(name: String(name.prefix(80)), description: String(description.prefix(300)))); save()
    }
    func add(_ track: Track, playlistID: String) {
        guard let index = state.playlists.firstIndex(where: { $0.id == playlistID }) else { return }
        state.playlists[index].add(track); save()
    }
    func remove(_ track: Track, playlistID: String) {
        guard let index = state.playlists.firstIndex(where: { $0.id == playlistID }) else { return }
        state.playlists[index].tracks.removeAll { $0.key == track.key }; save()
    }
    func search(_ query: String) async {
        let key = UUID(); searchGeneration = key
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { results = []; searching = false; return }
        searching = true
        let local = Track.unique(state.local + state.favourites + state.playlists.flatMap(\.tracks)).filter { ($0.title + " " + $0.artist).localizedCaseInsensitiveContains(query) }
        results = local
        do { try await Task.sleep(for: .milliseconds(220)); try Task.checkCancellation() } catch { if searchGeneration == key { searching = false }; return }
        async let publicTracks = searchCompanion(query)
        async let spotifyTracks = searchSpotify(query)
        let remote = await publicTracks + spotifyTracks
        guard key == searchGeneration, !Task.isCancelled else { return }
        results = Track.unique(local + remote); searching = false
        if results.isEmpty { message = "No songs found. Try another search, connect Spotify, or pair your Mac in Settings." }
    }
    private func searchSpotify(_ query: String) async -> [Track] {
        if !spotify.hasToken { await deviceSync.refreshPlaybackConnection() }
        return await spotify.searchAvailable(query)
    }
    private func searchCompanion(_ query: String) async -> [Track] {
        if !UserDefaults.standard.bool(forKey: "companionManualOverride") { await deviceSync.refreshPlaybackConnection() }
        guard !Task.isCancelled else { return [] }
        return (try? await companion.search(query)) ?? []
    }
    func refreshRecommendations() async {
        guard !refreshing else { return }; refreshing = true; defer { refreshing = false }
        let taste = Track.unique(state.favourites + state.playlists.flatMap(\.tracks) + state.history)
        let seed = taste.first
        guard let seed else { recommendations = []; return }
        let query = seed.artist == "Unknown artist" ? seed.title : seed.artist
        async let remote: [Track] = { [companion] in (try? await companion.search(query)) ?? [] }()
        async let spotifyTracks = searchSpotify(query)
        let tracks = await remote + spotifyTracks
        let recent = Set(state.history.prefix(8).map(\.key))
        recommendations = Array(Track.unique(tracks + taste).filter { !recent.contains($0.key) }.prefix(20))
    }
    func loadSpotifyPlaylists() async {
        syncing = true; defer { syncing = false }
        do { spotifyChoices = try await spotify.playlists() } catch { message = error.localizedDescription }
    }
    func syncSpotify(_ selected: Set<String>) async -> Bool {
        syncing = true; defer { syncing = false }
        do {
            var imported: [Playlist] = []
            for var playlist in spotifyChoices where selected.contains(playlist.spotifyID ?? "") {
                playlist.tracks = try await spotify.playlistTracks(playlist.spotifyID!); imported.append(playlist)
            }
            state.playlists.removeAll { $0.spotifyID != nil }; state.playlists += imported
            state.selectedSpotify = selected.sorted(); save(); await refreshRecommendations(); return true
        } catch { message = error.localizedDescription; return false }
    }
    func importAudio(_ urls: [URL]) async {
        for url in urls {
            let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                let hash = try await DeviceSync.digest(url)
                let id = "local_" + String(hash.prefix(12))
                guard !state.local.contains(where: { $0.id == id }) else { continue }
                let file = id + "." + url.pathExtension.lowercased()
                let destination = audioRoot.appendingPathComponent(file)
                if !FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.copyItem(at: url, to: destination) }
                let asset = AVURLAsset(url: destination)
                let duration = try? await asset.load(.duration)
                let metadata = (try? await asset.load(.commonMetadata)) ?? []
                var title = url.deletingPathExtension().lastPathComponent; var artist = "Unknown artist"
                for item in metadata {
                    if item.commonKey == .commonKeyTitle, let value = try? await item.load(.stringValue), !value.isEmpty { title = value }
                    if item.commonKey == .commonKeyArtist, let value = try? await item.load(.stringValue), !value.isEmpty { artist = value }
                }
                state.local.append(Track(id: id, title: title, artist: artist, platform: "local", url: "", duration: duration?.seconds.isFinite == true ? duration?.seconds : nil, localFile: file)); save()
            } catch { message = "Could not import \(url.lastPathComponent): \(error.localizedDescription)" }
        }
    }
    #if DEBUG
    func seedPreview() {
        guard ProcessInfo.processInfo.environment["CUDA_DEMO"] == "1" else { return }
        let tracks = ["After hours", "Blue hour", "Slow morning", "Open road"].enumerated().map { index, name in
            Track(id: "demo-\(index)", title: name, artist: "Cuda Sessions", platform: "local", url: "", duration: 30, thumbnail: "demo-\(index)", localFile: "preview.wav")
        }
        if let tone = Bundle.main.url(forResource: "preview", withExtension: "wav") { try? FileManager.default.copyItem(at: tone, to: audioRoot.appendingPathComponent("preview.wav")) }
        state.local = tracks; state.favourites = Array(tracks.prefix(2)); state.history = tracks
        state.playlists = [Playlist(name: "Evening rotation", description: "For the way home", tracks: tracks), Playlist(name: "A little quieter", description: "Room to breathe", tracks: Array(tracks.suffix(2)))]
        recommendations = tracks
    }
    #endif
}
