import AVFoundation
import MediaPlayer
import UIKit

@MainActor
final class Player: ObservableObject {
    @Published var current: Track?
    @Published var playing = false
    @Published var loading = false
    @Published var position = 0.0
    @Published var duration = 0.0
    @Published var volume: Float = 1 { didSet { audio.volume = volume } }
    @Published var effects = AudioSettings() { didSet {
        equalizer.update(effects)
        if !usesSpotify, playing { audio.rate = effects.speed }
        if let data = try? JSONEncoder().encode(effects) { UserDefaults.standard.set(data, forKey: "audio-settings") }
    } }
    @Published private(set) var equalizerAvailable = false
    @Published private(set) var equalizerStatus = "Play a song to use the equalizer."
    @Published private(set) var sleepDeadline: Date?
    private let equalizer = EqualizerProcessor()
    private var sleepTask: Task<Void, Never>?
    @Published var source: Source = .auto
    @Published var queue: [Track] = []
    @Published var shuffle = false
    @Published var repeatOne = false
    @Published var error: String?
    let spotify: Spotify
    var companion: () -> Companion
    var offlineURL: ((Track) -> URL?)?
    @Published private(set) var offlinePlaying = false
    var usesSpotify: Bool { current?.platform == "spotify" && !offlinePlaying }
    var didPlay: ((Track) -> Void)?
    var prepareCompanion: (() async -> Void)?
    private var audio = AVPlayer()
    private var task: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var generation = UUID()
    private var queueIndex = 0
    private var status: NSKeyValueObservation?
    private var timeControl: NSKeyValueObservation?
    private var timeToken: Any?
    private var endToken: NSObjectProtocol?
    private var interruptToken: NSObjectProtocol?
    private var routeToken: NSObjectProtocol?
    private var localRoot: URL
    private var selectedOriginal: Track?
    private var excluded = Set<String>()

    init(spotify: Spotify, localRoot: URL, companion: @escaping () -> Companion) {
        self.spotify = spotify; self.localRoot = localRoot; self.companion = companion
        if let data = UserDefaults.standard.data(forKey: "audio-settings"), var settings = try? JSONDecoder().decode(AudioSettings.self, from: data) {
            settings.gains = AudioSettings.frequencies.indices.map { settings.gains.indices.contains($0) ? max(-12, min(12, settings.gains[$0])) : 0 }
            settings.speed = max(0.5, min(2, settings.speed)); effects = settings; equalizer.update(settings)
        }
        timeToken = audio.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            Task { @MainActor in
                guard let self, !self.usesSpotify else { return }
                self.position = time.seconds.isFinite ? time.seconds : 0
                if let d = self.audio.currentItem?.duration.seconds, d.isFinite { self.duration = d }
                self.updateNowPlaying()
            }
        }
        timeControl = audio.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in
                guard let self, !self.usesSpotify else { return }
                self.playing = self.audio.timeControlStatus == .playing
                if self.playing { self.loading = false; self.watchdog?.cancel(); if let track = self.current { self.didPlay?(track) } }
                self.updateNowPlaying()
            }
        }
        endToken = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] notification in
            Task { @MainActor in
                guard let self, let item = notification.object as? AVPlayerItem, item === self.audio.currentItem else { return }
                if self.repeatOne { self.seek(0); self.startAudio() } else { self.next() }
            }
        }
        interruptToken = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            Task { @MainActor in
                guard let self, !self.usesSpotify, let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
                if type == .began { self.audio.pause() }
                else if let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt, AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) {
                    try? AVAudioSession.sharedInstance().setActive(true); self.startAudio()
                }
            }
        }
        routeToken = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            Task { @MainActor in
                if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self?.audio.pause() }
            }
        }
        spotify.onState = { [weak self] incoming, playing, position in
            guard let self, self.current == nil || self.usesSpotify else { return }
            var track = incoming
            track.thumbnail = self.current?.key == track.key ? self.current?.thumbnail : self.queue.first(where: { $0.key == track.key })?.thumbnail
            self.current = track; self.playing = playing; self.loading = false; self.position = position; self.duration = track.duration ?? 0
            if playing { self.didPlay?(track) }
        }
        spotify.onFailure = { [weak self] message in
            guard let self, let track = self.selectedOriginal, self.usesSpotify else { return }
            self.playing = false
            let companion = self.companion()
            if self.source == .auto, Companion.validAddress(companion.address), !companion.token.isEmpty, !self.excluded.contains(track.key) {
                self.excluded.insert(track.key); self.loading = true; self.load(track, generation: self.generation)
            } else { self.loading = false; self.error = message }
        }
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { [weak self] _ in Task { @MainActor in if self?.playing == false { self?.toggle() } }; return .success }
        commands.pauseCommand.addTarget { [weak self] _ in Task { @MainActor in if self?.playing == true { self?.toggle() } }; return .success }
        commands.nextTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.next() }; return .success }
        commands.previousTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.previous() }; return .success }
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(event.positionTime) }; return .success
        }
    }
    func play(_ track: Track, in tracks: [Track]? = nil) {
        if let tracks { queue = Track.unique(tracks); queueIndex = queue.firstIndex { $0.key == track.key } ?? 0 }
        else if queue.isEmpty || !queue.contains(where: { $0.key == track.key }) { queue = [track]; queueIndex = 0 }
        offlinePlaying = false; equalizerAvailable = false; equalizerStatus = "Preparing audio…"
        selectedOriginal = track; excluded = []; generation = UUID(); task?.cancel(); watchdog?.cancel()
        audio.pause(); audio.replaceCurrentItem(with: nil); status = nil
        current = track; position = 0; duration = track.duration ?? 0; loading = true; playing = false; error = nil
        load(track, generation: generation)
    }
    private func load(_ track: Track, generation key: UUID) {
        task = Task {
            do {
                let cached = source == .auto ? offlineURL?(track) : nil
                offlinePlaying = cached != nil
                if cached == nil && (source == .spotify || (track.platform == "spotify" && source == .auto && !excluded.contains(track.key))) {
                    var selected = track
                    if track.platform != "spotify" {
                        let candidates = try await spotify.search(track.artist + " " + track.title)
                        func normalized(_ value: String) -> String { value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current).components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ") }
                        guard let match = candidates.first(where: {
                            normalized($0.title) == normalized(track.title) && normalized($0.artist).contains(normalized(track.artist)) &&
                            (track.duration == nil || $0.duration == nil || abs((track.duration ?? 0) - ($0.duration ?? 0)) <= 12)
                        }) else { throw CudaError.message("No matching Spotify recording was found. Choose Auto or another source.") }
                        selected = match
                    }
                    try Task.checkCancellation(); guard generation == key else { return }
                    current = selected
                    do { try spotify.play(selected) }
                    catch {
                        let companion = self.companion()
                        guard source == .auto, Companion.validAddress(companion.address), !companion.token.isEmpty else { throw error }
                        excluded.insert(track.key); load(track, generation: key); return
                    }
                    equalizerStatus = "Spotify plays in the Spotify app. Use its equalizer for Spotify audio."
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
                    return
                }
                spotify.deactivate()
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                try AVAudioSession.sharedInstance().setActive(true)
                let selected: Track; let url: URL
                if let cached { selected = track; url = cached }
                else if track.platform == "local", let file = track.localFile, !file.contains("/"), !file.contains("..") {
                    selected = track; url = localRoot.appendingPathComponent(file)
                } else {
                    await prepareCompanion?()
                    try Task.checkCancellation(); guard generation == key else { return }
                    (selected, url) = try await companion().stream(track, source: source, excluded: Array(excluded))
                }
                try Task.checkCancellation(); guard generation == key else { return }
                current = selected; duration = selected.duration ?? 0
                let item = AVPlayerItem(url: url)
                status = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                    Task { @MainActor in
                        guard let self, self.generation == key else { return }
                        if item.status == .failed { self.failed(item.error?.localizedDescription ?? "This audio stream could not start.", generation: key) }
                    }
                }
                item.audioTimePitchAlgorithm = .spectral
                audio.replaceCurrentItem(with: item); startAudio()
                Task { [weak self, weak item] in
                    guard let self, let item else { return }
                    do {
                        let tracks = try await item.asset.loadTracks(withMediaType: .audio)
                        try Task.checkCancellation(); guard self.generation == key, self.audio.currentItem === item else { return }
                        guard let track = tracks.first else { self.equalizerStatus = "EQ isn't available on this stream. Download the playlist for offline audio effects."; return }
                        let tap = try PlayerAudioTap(self.equalizer) { [weak self] supported in
                            Task { @MainActor in
                                guard let self, self.generation == key else { return }
                                self.equalizerAvailable = supported
                                self.equalizerStatus = supported ? "Equalizer ready" : "EQ isn't available for this audio format."
                            }
                        }.create()
                        let parameters = AVMutableAudioMixInputParameters(track: track); parameters.audioTapProcessor = tap
                        let mix = AVMutableAudioMix(); mix.inputParameters = [parameters]; item.audioMix = mix
                        self.equalizerStatus = "Checking stream support…"
                        Task { [weak self] in
                            try? await Task.sleep(for: .seconds(6))
                            guard let self, self.generation == key, !self.equalizerAvailable else { return }
                            self.equalizerStatus = "EQ isn't available on this stream. Download the playlist to use audio effects offline."
                        }
                    } catch { if self.generation == key { self.equalizerStatus = "EQ isn't available on this stream. Download the playlist to use audio effects offline." } }
                }
                watchdog = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(15)) } catch { return }
                    guard let self, self.generation == key, self.loading else { return }
                    self.failed("Audio took too long to start. Try another source.", generation: key)
                }
            } catch is CancellationError { }
            catch { guard generation == key else { return }; loading = false; playing = false; self.error = error.localizedDescription }
        }
    }
    private func failed(_ message: String, generation key: UUID) {
        guard generation == key else { return }; watchdog?.cancel(); audio.pause()
        if source == .auto, let original = selectedOriginal, let current, current.platform != "local", current.platform != "spotify", excluded.count < 3 {
            excluded.insert(current.key); loading = true; load(original, generation: key)
        } else { loading = false; playing = false; error = message }
    }
    func toggle() {
        guard let current else { return }
        if usesSpotify { do { try spotify.toggle(paused: !playing) } catch { self.error = error.localizedDescription }; return }
        if loading { task?.cancel(); watchdog?.cancel(); generation = UUID(); loading = false; audio.pause(); return }
        if playing { audio.pause() } else if audio.currentItem?.status == .failed || audio.currentItem == nil { play(current) } else { startAudio() }
    }
    private func startAudio() { audio.playImmediately(atRate: max(0.5, min(2, effects.speed))) }
    func sleep(after minutes: Int?) {
        sleepTask?.cancel(); sleepDeadline = minutes.map { Date(timeIntervalSinceNow: Double($0 * 60)) }
        guard let minutes else { return }
        sleepTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(minutes * 60)) } catch { return }
            guard let self else { return }
            if self.usesSpotify { try? self.spotify.toggle(paused: false) } else { self.audio.pause() }
            self.playing = false; self.sleepDeadline = nil
        }
    }
    func stop() {
        task?.cancel(); watchdog?.cancel(); generation = UUID(); audio.pause(); audio.replaceCurrentItem(with: nil); spotify.deactivate()
        current = nil; selectedOriginal = nil; playing = false; loading = false; offlinePlaying = false; equalizerAvailable = false; equalizerStatus = "Play a song to use the equalizer."; sleep(after: nil)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
    func seek(_ seconds: Double) {
        let value = max(0, min(seconds, max(duration, 0)))
        if usesSpotify { spotify.seek(value) }
        else { audio.seek(to: CMTime(seconds: value, preferredTimescale: 600)); position = value }
    }
    func next() {
        if queue.count <= 1, usesSpotify { spotify.next(); return }
        guard !queue.isEmpty else { return }
        if shuffle && queue.count > 1 { queueIndex = (0..<queue.count).filter { $0 != queueIndex }.randomElement() ?? 0 }
        else { guard queueIndex + 1 < queue.count else { audio.pause(); playing = false; return }; queueIndex += 1 }
        play(queue[queueIndex], in: queue)
    }
    func previous() {
        if position > 3 { seek(0); return }
        if queue.count <= 1, usesSpotify { spotify.previous(); return }
        guard !queue.isEmpty else { return }; queueIndex = max(0, queueIndex - 1); play(queue[queueIndex], in: queue)
    }
    func changeSource(_ value: Source) { source = value; if let track = selectedOriginal ?? current { play(track, in: queue) } }
    func disconnectCompanion() {
        guard let current, !offlinePlaying, current.platform != "local", current.platform != "spotify" else { return }
        task?.cancel(); watchdog?.cancel(); generation = UUID(); audio.pause(); audio.replaceCurrentItem(with: nil)
        playing = false; loading = false
    }
    private func updateNowPlaying() {
        guard let current, !usesSpotify else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: current.title, MPMediaItemPropertyArtist: current.artist,
            MPMediaItemPropertyPlaybackDuration: duration, MPNowPlayingInfoPropertyElapsedPlaybackTime: position, MPNowPlayingInfoPropertyPlaybackRate: playing ? effects.speed : 0]
    }
}
