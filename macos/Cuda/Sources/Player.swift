import AVFoundation
import MediaPlayer
import AppKit

@MainActor
final class Player: ObservableObject {
    @Published var current: Track?
    @Published var queue: [Track] = []
    @Published var playing = false
    @Published var loading = false
    @Published var position = 0.0
    @Published var duration = 0.0
    @Published var source: Source = .auto
    @Published var volume: Float = 0.85 { didSet { applyEffects() } }
    @Published var effects = Effects() { didSet { applyEffects() } }
    @Published var shuffle = false
    @Published var repeatOne = false
    @Published var error: String?
    let runtime: Runtime
    var offlineURL: ((Track) -> URL?)?
    @Published private(set) var offlinePlaying = false
    private var usesSpotify: Bool { current?.platform == "spotify" && !offlinePlaying }
    var didPlay: ((Track) -> Void)?
    private let local = LocalAudio()
    private var task: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var generation = UUID()
    private var original: Track?
    private var excluded = Set<String>()
    private var effectsTask: Task<Void, Never>?
    private var timer: Timer?
    private var pendingPosition = 0.0
    private var wantsPlay = true
    init(runtime: Runtime) {
        self.runtime = runtime
        if let data = try? Data(contentsOf: runtime.directory.appendingPathComponent("native-audio.json")), let preferences = try? JSONDecoder().decode(AudioPreferences.self, from: data) { volume = min(1, max(0, preferences.volume)); effects = preferences.effects }
        local.ended = { [weak self] in self?.ended() }
        local.streamReady = { [weak self] in guard let self else { return }; self.loading = false; self.playing = self.wantsPlay; self.watchdog?.cancel(); if let track = self.current { self.didPlay?(track) }; self.updateNowPlaying() }
        local.streamFailed = { [weak self] in guard let self else { return }; let key = self.generation; Task { await self.failed("This audio stream stopped. Choose another source or try again.", key: key) } }
        timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            Task { @MainActor in guard let self, self.current != nil, !self.usesSpotify else { return }; self.position = self.local.position; self.playing = self.local.playing; self.updateNowPlaying() }
        }
        let remote = MPRemoteCommandCenter.shared()
        remote.playCommand.addTarget { [weak self] _ in Task { @MainActor in if self?.playing == false { self?.toggle() } }; return .success }
        remote.pauseCommand.addTarget { [weak self] _ in Task { @MainActor in if self?.playing == true { self?.toggle() } }; return .success }
        remote.nextTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.next() }; return .success }
        remote.previousTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.previous() }; return .success }
        remote.changePlaybackPositionCommand.addTarget { [weak self] event in guard let value = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }; Task { @MainActor in self?.seek(value.positionTime) }; return .success }
    }
    func play(_ track: Track, in tracks: [Track]? = nil, at seconds: Double = 0, paused: Bool = false) {
        if let tracks { queue = Track.unique(tracks) } else if !queue.contains(where: { $0.sameRecording(track) }) { queue = [track] }
        task?.cancel(); watchdog?.cancel(); generation = UUID(); let key = generation
        offlinePlaying = false
        original = track; excluded = []; current = track; position = seconds; pendingPosition = seconds; wantsPlay = !paused
        duration = track.duration ?? 0; playing = false; loading = true; error = nil
        local.stop()
        task = Task { await load(track, key: key) }
    }
    private func load(_ track: Track, key: UUID) async {
        do {
            if source == .auto, let url = offlineURL?(track) {
                try? await runtime.spotifyVoid("playback", ["stop"])
                try Task.checkCancellation(); guard generation == key else { return }
                offlinePlaying = true; current = track
                try local.load(url); duration = local.duration
                local.seek(pendingPosition, play: wantsPlay); local.apply(effects, volume: volume)
                loading = false; playing = wantsPlay; didPlay?(track); updateNowPlaying(); return
            }
            let selected: Track
            var stream: StreamInfo?
            if track.platform == "local" { selected = track }
            else if source.rawValue == track.platform && source != .auto { selected = track }
            else if source != .auto {
                let result: PlaybackResponse = try await runtime.api(path("/api/resolve-source", ["title": track.title, "artist": track.artist, "source": source.rawValue, "id": track.id, "platform": track.platform, "url": track.url, "duration": String(track.duration ?? 0)]))
                guard let match = result.track else { throw CudaError.message("No matching recording was found on \(source.label).") }; selected = match
            } else {
                let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(track))
                let result: PlaybackResponse = try await runtime.api("/api/playback-source", body: ["track": object, "exclude": Array(excluded), "nativeApple": false])
                guard let match = result.track else { throw CudaError.message("No playable source was found.") }; selected = match; stream = result.stream
            }
            try Task.checkCancellation(); guard generation == key else { return }; var chosen = selected
            if chosen.key != track.key { chosen.alternatives = Track.unique((chosen.alternatives ?? []) + [track]) }
            current = chosen; duration = selected.duration ?? 0
            if selected.platform == "spotify" {
                if selected.key != track.key || track.platform == "spotify" {
                    try await runtime.spotifyVoid("playback", ["load", ["uri": "spotify:track:" + selected.id, "play": wantsPlay, "positionMs": Int(pendingPosition * 1000), "volume": volume, "effects": effects.json]])
                } else {
                    let result: PlaybackResponse = try await runtime.api(path("/api/resolve-source", ["title": track.title, "artist": track.artist, "source": "spotify", "id": track.id, "platform": track.platform, "url": track.url]))
                    guard let match = result.track else { throw CudaError.message("No matching recording was found on Spotify.") }; current = match
                    try await runtime.spotifyVoid("playback", ["load", ["uri": "spotify:track:" + match.id, "play": wantsPlay, "volume": volume, "effects": effects.json]])
                }
                try Task.checkCancellation(); guard generation == key else { return }
                loading = false
            } else {
                try? await runtime.spotifyVoid("playback", ["stop"])
                try Task.checkCancellation(); guard generation == key else { return }
                if selected.platform == "local" {
                    let index = try JSONSerialization.jsonObject(with: Data(contentsOf: runtime.directory.appendingPathComponent("library.json"))) as? [String: [String: Any]]
                    guard let file = index?[selected.id]?["file"] as? String, file.range(of: "^local_[a-f0-9]{12}\\.[a-z0-9]+$", options: .regularExpression) != nil else { throw CudaError.message("This imported file is missing. Import it again from Shelf.") }
                    let url = runtime.directory.appendingPathComponent("library/" + file)
                    do {
                        try local.load(url); duration = local.duration
                        local.seek(pendingPosition, play: wantsPlay); local.apply(effects, volume: volume); loading = false; playing = wantsPlay
                        didPlay?(selected); updateNowPlaying()
                    } catch {
                        try local.loadStream(url, binary: Bundle.main.resourceURL!.appendingPathComponent("tools/bin/cuda-audio-decoder"), duration: duration, offset: pendingPosition, play: wantsPlay)
                        local.apply(effects, volume: volume)
                    }
                } else {
                    if stream == nil { stream = try await runtime.api(path("/api/stream-info", ["id": selected.id, "url": selected.url, "platform": selected.platform, "mobile": "0"])) }
                    try Task.checkCancellation(); guard generation == key else { return }
                    guard let raw = stream?.proxyUrl ?? stream?.streamUrl ?? stream?.url, let url = URL(string: raw) else { throw CudaError.message("No Apple-compatible audio was found. Choose another source.") }
                    try local.loadStream(url, binary: Bundle.main.resourceURL!.appendingPathComponent("tools/bin/cuda-audio-decoder"), duration: duration, offset: pendingPosition, play: wantsPlay)
                    local.apply(effects, volume: volume)
                    watchdog = Task { [weak self] in do { try await Task.sleep(for: .seconds(12)) } catch { return }; guard let self, self.generation == key, self.loading else { return }; await self.failed("Audio took too long to start.", key: key) }
                }
            }
        } catch is CancellationError { }
        catch { guard generation == key else { return }; await failed(error.localizedDescription, key: key) }
    }
    private func failed(_ message: String, key: UUID) async {
        guard generation == key else { return }; watchdog?.cancel(); local.stop(); playing = false
        if source == .auto, let original, let current, current.platform != "local", excluded.count < 3, !excluded.contains(current.key) {
            excluded.insert(current.key); loading = true; await load(original, key: key)
        } else { loading = false; error = message }
    }
    func spotifyEvent(_ value: [String: Any]) {
        guard usesSpotify else { return }
        if let uri = value["uri"] as? String, !uri.hasSuffix(current?.id ?? "") { return }
        switch value["event"] as? String {
        case "metadata":
            current = current?.withPlaybackMetadata(value)
            duration = current?.duration ?? duration
        case "playing":
            if !wantsPlay { playing = false; loading = false; Task { try? await runtime.spotifyVoid("playback", ["pause"]) } }
            else { playing = true; loading = false; if let current { didPlay?(current) } }
        case "paused": playing = false; loading = false
        case "ended": ended()
        case "error": let key = generation; Task { await failed(value["error"] as? String ?? "Spotify playback failed. Reconnect playback in Settings.", key: key) }
        default: break
        }
        if let ms = value["positionMs"] as? Double { position = ms / 1000 }
        updateNowPlaying()
    }
    func toggle() {
        guard let current else { return }
        if loading {
            let pending = task; task?.cancel(); watchdog?.cancel(); generation = UUID(); let key = generation; wantsPlay = false; local.stop(); loading = false; playing = false
            Task { await pending?.value; guard generation == key else { return }; try? await runtime.spotifyVoid("playback", ["stop"]) }; return
        }
        wantsPlay = !playing
        if usesSpotify { let command = playing ? "pause" : "resume"; Task { do { try await runtime.spotifyVoid("playback", [command]) } catch { self.error = error.localizedDescription } } }
        else if playing { local.pause(); playing = false }
        else if local.loaded { local.resume(); playing = local.playing }
        else { play(current) }
        updateNowPlaying()
    }
    func seek(_ seconds: Double) {
        position = min(max(0, seconds), duration); pendingPosition = position
        if usesSpotify { Task { try? await runtime.spotifyVoid("playback", ["seek", ["positionMs": Int(position * 1000)]]) } }
        else { local.seek(position, play: playing) }
        updateNowPlaying()
    }
    func next() { guard !queue.isEmpty else { return }; let index = queue.firstIndex { $0.sameRecording(current) } ?? -1; let others = queue.indices.filter { $0 != index }; let next = shuffle && queue.count > 1 ? others.randomElement()! : (index + 1) % queue.count; play(queue[next]) }
    func previous() { if position > 3 { seek(0) } else if !queue.isEmpty { let index = queue.firstIndex { $0.sameRecording(current) } ?? 0; play(queue[(index - 1 + queue.count) % queue.count]) } }
    func changeSource(_ value: Source) { source = value; if let original { play(original, at: position, paused: loading ? !wantsPlay : !playing) } }
    private func ended() { if repeatOne, let current { play(current) } else { next() } }
    func applyEffects() {
        if let data = try? JSONEncoder().encode(AudioPreferences(volume: volume, effects: effects)) { try? data.write(to: runtime.directory.appendingPathComponent("native-audio.json"), options: .atomic) }
        local.apply(effects, volume: volume)
        effectsTask?.cancel()
        effectsTask = Task { do { try await Task.sleep(for: .milliseconds(100)); if usesSpotify { try await runtime.spotifyVoid("playback", ["effects", ["effects": effects.json, "volume": volume]]) } } catch is CancellationError { } catch { self.error = error.localizedDescription } }
    }
    func stop() { wantsPlay = false; Task { try? await runtime.spotifyVoid("playback", ["stop"]) }; generation = UUID(); task?.cancel(); watchdog?.cancel(); local.stop(); playing = false; loading = false; current = nil; MPNowPlayingInfoCenter.default().nowPlayingInfo = nil }
    private func updateNowPlaying() {
        guard let current else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: current.title, MPMediaItemPropertyArtist: current.artist, MPMediaItemPropertyPlaybackDuration: duration, MPNowPlayingInfoPropertyElapsedPlaybackTime: position, MPNowPlayingInfoPropertyPlaybackRate: playing ? effects.speed : 0]
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    }
}
func path(_ route: String, _ values: [String: String]) -> String {
    var parts = URLComponents(); parts.path = route; parts.queryItems = values.map { URLQueryItem(name: $0.key, value: $0.value) }; return parts.string!
}

private struct AudioPreferences: Codable { var volume: Float; var effects: Effects }
