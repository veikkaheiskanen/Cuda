import Foundation
import AppKit
import UniformTypeIdentifiers

@MainActor
final class Store: ObservableObject {
    @Published var state = CollectionState()
    @Published var results: [Track] = []
    @Published var recommendations: [Track] = []
    @Published var spotify = SpotifyStatus()
    @Published var choices: [SpotifyChoice] = []
    @Published var searching = false
    @Published var refreshing = false
    @Published var mood = "all"
    @Published var syncing = false
    @Published var ready = false
    @Published var offline = OfflinePlaylistState()
    @Published var downloadingPlaylist: String?
    @Published var downloadProgress = ""
    private var playlistDownload: Task<Void, Never>?
    var offlineRoot: URL { runtime.directory.appendingPathComponent("offline-playlists", isDirectory: true) }
    private var offlineFile: URL { runtime.directory.appendingPathComponent("native-offline-playlists.json") }
    @Published var message: String?
    @Published var notice: String?
    let runtime = Runtime()
    lazy var player: Player = {
        let player = Player(runtime: runtime)
        player.offlineURL = { [weak self] track in guard let self else { return nil }; return self.offline.available(track, root: self.offlineRoot) }
        player.didPlay = { [weak self] track in self?.played(track) }
        return player
    }()
    lazy var deviceSync = MacShelfSync(store: self)
    lazy var discord = DiscordPresenceController(runtime: runtime, player: player)
    private var starting = false
    private var queryToken = ""
    private var likeTask: Task<Void, Never>?
    private var file: URL { runtime.directory.appendingPathComponent("native-shelf.json") }
    init() {
        if let data = try? Data(contentsOf: offlineFile), let saved = try? JSONDecoder().decode(OfflinePlaylistState.self, from: data) { offline = saved }
        if let data = try? Data(contentsOf: file), let value = try? JSONDecoder().decode(CollectionState.self, from: data) { state = value }
        runtime.event = { [weak self] event in self?.receive(event) }
    }
    func start() async {
        guard !starting, !ready else { return }; starting = true; defer { starting = false }
        do {
            let data = try await runtime.start()
            if let value = try JSONSerialization.jsonObject(with: data) as? [String: Any], let status = value["status"], let bytes = try? JSONSerialization.data(withJSONObject: status) { spotify = (try? JSONDecoder().decode(SpotifyStatus.self, from: bytes)) ?? SpotifyStatus() }
            if let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let shelf = value["shelf"], let bytes = try? JSONSerialization.data(withJSONObject: shelf), let migrated = try? JSONDecoder().decode(CollectionState.self, from: bytes) { state = migrated }
            state.local = try await runtime.api("/api/library")
            if ProcessInfo.processInfo.environment["CUDA_NATIVE_DEMO"] == "1" { await demo() }
            ready = true
            discord.start()
            deviceSync.start()
            recommendations = Array(Track.unique(spotify.tracks + state.favourites + state.local).prefix(20))
        } catch { message = error.localizedDescription }
    }
    private func receive(_ event: [String: Any]) {
        if event["event"] as? String == "syncChanged" { Task { await deviceSync.sync() } }
        if event["event"] as? String == "discord", let value = event["value"] as? [String: Any] { discord.receive(value) }
        if event["event"] as? String == "spotify", let value = event["value"] as? [String: Any] {
            if value["event"] as? String == "library", let data = try? JSONSerialization.data(withJSONObject: value), let status = try? JSONDecoder().decode(SpotifyStatus.self, from: data) { spotify = status }
            else { player.spotifyEvent(value) }
        }
        if event["event"] as? String == "search", event["token"] as? String == queryToken, let value = event["value"], let data = try? JSONSerialization.data(withJSONObject: value), let response = try? JSONDecoder().decode(SearchResponse.self, from: data) { results = response.tracks ?? [] }
    }
    func search(_ query: String) async {
        let token = UUID().uuidString; queryToken = token
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty { searching = false; results = []; return }
        searching = true
        do {
            try await Task.sleep(for: .milliseconds(150)); try Task.checkCancellation()
            let data = try await runtime.call("search", ["query": query, "token": token]); try Task.checkCancellation()
            guard token == queryToken else { return }; results = (try? JSONDecoder().decode(SearchResponse.self, from: data).tracks) ?? []; searching = false
        } catch is CancellationError { if token == queryToken { searching = false } }
        catch { if token == queryToken { searching = false; message = error.localizedDescription } }
    }
    func refresh() async {
        guard ready, !refreshing else { return }; refreshing = true; defer { refreshing = false }
        do {
            let taste = Track.unique(state.favourites + state.playlists.flatMap(\.tracks) + state.history + spotify.tracks)
            let favourites = try JSONSerialization.jsonObject(with: JSONEncoder().encode(Array(taste.prefix(100))))
            let response: SearchResponse = try await runtime.api("/api/vibe", body: ["favorites": favourites, "genre": mood, "limit": 20])
            recommendations = response.tracks ?? []
        } catch { notice = "Recommendations are unavailable right now. Your Shelf is still ready to play." }
    }
    func save() { do { try JSONEncoder().encode(state.saved()).write(to: file, options: .atomic); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path); deviceSync.changed() } catch { message = "Cuda could not save your Shelf. Check free disk space." } }
    func played(_ track: Track) {
        guard state.history.first?.sameRecording(track) != true else { return }
        state.history.removeAll { $0.sameRecording(track) }; state.history.insert(track, at: 0); state.history = Array(state.history.prefix(200)); deviceSync.played(track); save()
        if track.platform == "spotify" { Task { try? await runtime.spotifyVoid("played", [try JSONSerialization.jsonObject(with: JSONEncoder().encode(track))]) } }
    }
    func favourite(_ track: Track) {
        let liked = !state.favourites.contains { $0.sameRecording(track) }
        if liked { state.favourites.insert(track, at: 0) } else { state.favourites.removeAll { $0.sameRecording(track) } }; save()
        if track.platform == "spotify", spotify.connected {
            let previous = likeTask
            likeTask = Task { await previous?.value; do { try await runtime.spotifyVoid("like", ["spotify:track:" + track.id, liked]) } catch { notice = "Saved on Shelf. Spotify couldn’t sync this favourite; reconnect your account to retry." } }
        }
    }
    func add(_ track: Track, to id: String) { guard let index = state.playlists.firstIndex(where: { $0.id == id }) else { return }; state.playlists[index].add(track); save() }
    func createPlaylist(name: String, description: String) { state.playlists.append(Playlist(name: name, description: description)); save() }
    func importAudio() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.audio]; panel.allowsMultipleSelection = true; panel.canChooseDirectories = false; panel.message = "Add music files to your Shelf."
        panel.begin { response in Task { @MainActor in guard response == .OK else { return }; await self.importAudio(panel.urls) } }
    }
    func importAudio(_ urls: [URL]) async {
        do { let data = try await runtime.call("import", ["paths": urls.map(\.path)]); state.local = try JSONDecoder().decode([Track].self, from: data); save() } catch { message = error.localizedDescription }
    }
    func connectSpotify(_ client: String, playback: Bool = false) async {
        syncing = true; defer { syncing = false }
        do { spotify = try await runtime.spotify(playback ? "connectPlayback" : "connect", playback ? [] : [client]) } catch { message = error.localizedDescription }
    }
    func loadChoices() async { syncing = true; defer { syncing = false }; do { choices = try await runtime.spotify("playlists") } catch { message = error.localizedDescription } }
    func sync(_ ids: Set<String>) async -> Bool {
        syncing = true; defer { syncing = false }
        do {
            spotify = try await runtime.spotify("sync", [Array(ids)])
            var imported: [Playlist] = []
            for choice in choices where ids.contains(choice.id) {
                let tracks: [Track] = try await runtime.spotify("playlistTracks", [choice.id])
                imported.append(Playlist(id: "spotify-" + choice.id, name: choice.name, description: "From Spotify · " + (choice.owner ?? "Your playlists"), tracks: tracks, spotifyID: choice.id))
            }
            let importedIDs = Set(imported.map(\.id)); state.playlists.removeAll { importedIDs.contains($0.id) }; state.playlists += imported; state.selectedSpotify = ids.sorted(); save(); await refresh(); return true
        } catch { message = error.localizedDescription; return false }
    }
    func exportShelf() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "Cuda-Shelf.json"; panel.allowedContentTypes = [.json]
        panel.begin { result in if result == .OK, let url = panel.url { do { try JSONEncoder().encode(self.state.saved()).write(to: url, options: .atomic) } catch { self.message = error.localizedDescription } } }
    }
    func importShelf() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]
        panel.begin { result in if result == .OK, let url = panel.url { do {
            let value = try JSONDecoder().decode(CollectionState.self, from: Data(contentsOf: url))
            self.state.favourites = Track.unique(self.state.favourites + value.favourites); self.state.history = Track.unique(self.state.history + value.history)
            for playlist in value.playlists where !self.state.playlists.contains(where: { $0.id == playlist.id }) { self.state.playlists.append(playlist) }; self.save()
        } catch { self.message = "This is not a Cuda Shelf backup." } } }
    }
    func genreRadio(_ genre: String) async {
        guard spotify.connected && spotify.playbackConnected else { message = "Connect Spotify library and playback in Settings first."; return }
        do { let tracks: [Track] = try await runtime.spotify("radio", [genre]); if let first = tracks.first { player.play(first, in: tracks) } else { notice = "No songs were found for this station." } } catch { notice = error.localizedDescription }
    }
    func weeklyPicks() async {
        guard spotify.connected, !refreshing else { return }; refreshing = true; defer { refreshing = false }
        do { spotify.weekly = try await runtime.spotify("weekly") } catch { notice = error.localizedDescription }
    }
    func addAlbum(_ album: SpotifyAlbum) async {
        do {
            spotify = try await runtime.spotify("shelf", [album.id])
            let tracks: [Track] = try await runtime.spotify("albumTracks", [album.id])
            let playlist = Playlist(id: "album-" + album.id, name: album.name, description: album.artists.map(\.name).joined(separator: ", "), tracks: tracks)
            if !state.playlists.contains(where: { $0.id == playlist.id }) { state.playlists.append(playlist); save() }
            notice = "Added to Shelf."
        } catch { message = error.localizedDescription }
    }
    func offlineCount(_ playlist: Playlist) -> Int { playlist.tracks.filter { track in offline.available(track, root: offlineRoot) != nil || track.platform == "local" && state.local.contains(where: { $0.key == track.key }) }.count }
    func downloadPlaylist(_ id: String) {
        guard downloadingPlaylist == nil, let playlist = state.playlists.first(where: { $0.id == id }) else { return }
        downloadingPlaylist = id
        playlistDownload = Task {
            var failed = 0
            offline.playlists[id] = playlist.tracks.map(\.key)
            defer { try? JSONEncoder().encode(offline).write(to: offlineFile, options: .atomic); downloadingPlaylist = nil; downloadProgress = ""; playlistDownload = nil }
            for (index, track) in playlist.tracks.enumerated() {
                if Task.isCancelled { break }
                downloadProgress = "Downloading \(index + 1) of \(playlist.tracks.count)…"
                if track.platform == "local" || offline.available(track, root: offlineRoot) != nil { continue }
                do {
                    struct Result: Decodable { var filename: String }
                    let result = try JSONDecoder().decode(Result.self, from: await runtime.call("playlistOffline", ["track": JSONSerialization.jsonObject(with: JSONEncoder().encode(track))]))
                    try Task.checkCancellation()
                    guard result.filename.range(of: "^[a-f0-9]{64}\\.m4a$", options: .regularExpression) != nil else { throw CudaError.message("Invalid download file.") }
                    offline.files[track.key] = result.filename; offline.playlists[id] = playlist.tracks.map(\.key)
                    try JSONEncoder().encode(offline).write(to: offlineFile, options: .atomic)
                } catch { failed += 1 }
            }
            notice = Task.isCancelled ? "Download paused. \(offlineCount(playlist)) of \(playlist.tracks.count) songs are available on this Mac." : failed > 0 ? "Saved \(offlineCount(playlist)) of \(playlist.tracks.count) songs on this Mac. \(failed) could not be downloaded from a matching public source." : "Playlist saved on this Mac. These downloads won’t sync to your iPhone."
        }
    }
    func cancelPlaylistDownload() { playlistDownload?.cancel() }
    func removePlaylistDownloads(_ id: String) {
        guard downloadingPlaylist == nil else { return }
        offline.playlists.removeValue(forKey: id)
        let keep = Set(offline.playlists.values.flatMap { $0 })
        for key in Array(offline.files.keys) where !keep.contains(key) { if let filename = offline.files.removeValue(forKey: key), filename.range(of: "^[a-f0-9]{64}\\.m4a$", options: .regularExpression) != nil { try? FileManager.default.removeItem(at: offlineRoot.appendingPathComponent(filename)) } }
        try? JSONEncoder().encode(offline).write(to: offlineFile, options: .atomic)
    }
    func setPlaylistArtwork(_ id: String) {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.image]; panel.canChooseDirectories = false; panel.message = "Choose a playlist cover."
        panel.begin { response in Task { @MainActor in
            guard response == .OK, let url = panel.url, let image = NSImage(contentsOf: url), let index = self.state.playlists.firstIndex(where: { $0.id == id }) else { return }
            let square = NSImage(size: NSSize(width: 384, height: 384)); square.lockFocus()
            let side = min(image.size.width, image.size.height)
            image.draw(in: NSRect(x: 0, y: 0, width: 384, height: 384), from: NSRect(x: (image.size.width-side)/2, y: (image.size.height-side)/2, width: side, height: side), operation: .copy, fraction: 1)
            square.unlockFocus()
            guard let tiff = square.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.65]), data.count <= 130000 else { self.message = "Choose a smaller image for your playlist cover."; return }
            self.state.playlists[index].artwork = "data:image/jpeg;base64," + data.base64EncodedString(); self.save()
        } }
    }
    func download(_ track: Track) async {
        do { let data = try await runtime.call("downloadOffline", ["path": path("/api/download", ["id": track.id, "url": track.url, "platform": track.platform, "title": track.title, "artist": track.artist])]); state.local = try JSONDecoder().decode([Track].self, from: data); save(); notice = "Saved offline and ready to sync." } catch { message = error.localizedDescription }
    }
    private func demo() async {
        guard let fixture = Bundle.main.url(forResource: "preview", withExtension: "wav") else { return }
        await importAudio([fixture])
        guard let local = state.local.first else { return }
        let names = ["After hours", "Blue hour", "Slow morning", "Open road"]
        let tracks = names.enumerated().map { index, name in Track(id: "local_" + String(format: "%012x", index + 1), title: name, artist: "Cuda Sessions", platform: "local", duration: 30, thumbnail: "demo-\(index)") }
        let indexURL = runtime.directory.appendingPathComponent("library.json")
        if let data = try? Data(contentsOf: indexURL), var index = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]], let entry = index[local.id] {
            for track in tracks { index[track.id] = entry }
            try? JSONSerialization.data(withJSONObject: index).write(to: indexURL, options: .atomic)
        }
        state.local = [tracks[0]]; state.history = tracks; state.favourites = [tracks[1],tracks[2]]
        state.playlists = [Playlist(name: "Evening rotation", description: "For the way home", tracks: [tracks[0],tracks[1]]),Playlist(name: "A little quieter", description: "Room to breathe",tracks:[tracks[2],tracks[3]])]
        recommendations = tracks; save()
    }
}
