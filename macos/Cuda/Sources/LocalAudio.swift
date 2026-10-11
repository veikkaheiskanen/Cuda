import AVFoundation

@MainActor
final class LocalAudio {
    let engine = AVAudioEngine()
    let node = AVAudioPlayerNode()
    let sourceMixer = AVAudioMixerNode()
    let eq = AVAudioUnitEQ(numberOfBands: 3)
    let pitch = AVAudioUnitTimePitch()
    let reverb = AVAudioUnitReverb()
    let delay = AVAudioUnitDelay()
    let distortion = AVAudioUnitDistortion()
    private var file: AVAudioFile?
    private var decoder: StreamDecoder?
    private var streaming = false
    private var streamURL: URL?
    private var streamBinary: URL?
    private var streamDuration = 0.0
    private var streamOffset = 0.0
    private var streamFormat: AVAudioFormat?
    var streamReady: (() -> Void)?
    var streamFailed: (() -> Void)?
    private var offset: AVAudioFramePosition = 0
    private var scheduledSample: AVAudioFramePosition = 0
    private var generation = UUID()
    var ended: (() -> Void)?
    init() {
        for unit in [node, sourceMixer, eq, pitch, reverb, delay, distortion] as [AVAudioNode] { engine.attach(unit) }
        for (index, frequency) in [120.0, 1000, 8000].enumerated() {
            eq.bands[index].filterType = index == 0 ? .lowShelf : index == 2 ? .highShelf : .parametric
            eq.bands[index].frequency = Float(frequency); eq.bands[index].bandwidth = 1; eq.bands[index].bypass = false
        }
        reverb.loadFactoryPreset(.mediumHall); reverb.wetDryMix = 0
        delay.delayTime = 0.25; delay.feedback = 25; delay.wetDryMix = 0
        distortion.loadFactoryPreset(.multiBrokenSpeaker); distortion.wetDryMix = 0
    }
    var duration: Double { if streaming { return streamDuration }; guard let file else { return 0 }; return Double(file.length) / file.processingFormat.sampleRate }
    var position: Double {
        if streaming {
            let sample = node.lastRenderTime.flatMap { node.playerTime(forNodeTime: $0)?.sampleTime } ?? 0
            return max(0, streamOffset + Double(max(0, sample)) / 44100)
        }
        guard let file else { return 0 }
        let sample = node.lastRenderTime.flatMap { node.playerTime(forNodeTime: $0)?.sampleTime } ?? scheduledSample
        return min(duration, max(0, Double(offset + max(0, sample - scheduledSample)) / file.processingFormat.sampleRate))
    }
    var loaded: Bool { file != nil || streaming }
    var playing: Bool { node.isPlaying }
    func load(_ url: URL) throws {
        stop(); file = try AVAudioFile(forReading: url)
        guard let file else { return }
        try configure(file.processingFormat); seek(0, play: true)
    }
    private func configure(_ format: AVAudioFormat) throws {
        engine.disconnectNodeOutput(node); engine.connect(node, to: sourceMixer, format: format)
        let processing = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let chain: [AVAudioNode] = [sourceMixer, eq, pitch, reverb, delay, distortion, engine.mainMixerNode]
        for i in 0..<(chain.count - 1) { engine.disconnectNodeOutput(chain[i]); engine.connect(chain[i], to: chain[i + 1], format: processing) }
        try engine.start()
    }
    func loadStream(_ url: URL, binary: URL, duration: Double, offset: Double = 0, play: Bool = true) throws {
        stop(); streaming = true; streamURL = url; streamBinary = binary; streamDuration = duration; streamOffset = max(0, offset)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        streamFormat = format; try configure(format)
        let source = StreamDecoder(), key = generation
        var received = false
        source.buffer = { [weak self] data, consumed in
            Task { @MainActor in
                guard let self, self.generation == key, let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(data.count / 8)), let channels = pcm.floatChannelData else { consumed(); return }
                pcm.frameLength = pcm.frameCapacity
                data.withUnsafeBytes { bytes in
                    let samples = bytes.bindMemory(to: Float.self)
                    for index in 0..<Int(pcm.frameLength) { channels[0][index] = samples[index * 2]; channels[1][index] = samples[index * 2 + 1] }
                }
                self.node.scheduleBuffer(pcm, completionCallbackType: .dataPlayedBack) { _ in consumed() }
                if !received { received = true; if play { self.node.play() }; self.streamReady?() }
            }
        }
        source.finished = { [weak self] success in Task { @MainActor in guard let self, self.generation == key else { return }; if success { self.ended?() } else { self.streamFailed?() } } }
        decoder = source; try source.start(url: url, binary: binary, offset: streamOffset)
    }
    func seek(_ seconds: Double, play: Bool) {
        if streaming, let url = streamURL, let binary = streamBinary { do { try loadStream(url, binary: binary, duration: streamDuration, offset: seconds, play: play) } catch { streamFailed?() }; return }
        guard let file else { return }
        generation = UUID(); let key = generation
        node.stop(); offset = min(max(0, AVAudioFramePosition(seconds * file.processingFormat.sampleRate)), max(0, file.length - 1))
        scheduledSample = 0
        node.scheduleSegment(file, startingFrame: offset, frameCount: AVAudioFrameCount(min(Int64(UInt32.max), file.length - offset)), at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in if self?.generation == key { self?.ended?() } }
        }
        if play { node.play() }
    }
    func pause() { node.pause() }
    func resume() { node.play() }
    func stop() { generation = UUID(); decoder?.stop(); decoder = nil; node.stop(); engine.stop(); file = nil; streaming = false; streamURL = nil; offset = 0 }
    func apply(_ effects: Effects, volume: Float) {
        node.volume = volume
        eq.bands[0].gain = Float(effects.low); eq.bands[1].gain = Float(effects.mid); eq.bands[2].gain = Float(effects.high)
        pitch.rate = Float(effects.speed); pitch.pitch = Float(effects.pitch * 100)
        reverb.wetDryMix = Float(effects.reverb); delay.wetDryMix = Float(effects.echo); distortion.wetDryMix = Float(effects.distortion)
    }
}
struct Effects: Codable, Equatable {
    var low = 0.0, mid = 0.0, high = 0.0
    var speed = 1.0, pitch = 0.0, reverb = 0.0, echo = 0.0, distortion = 0.0
    var json: [String: Any] { ["eq": ["low": low, "mid": mid, "high": high], "speed": speed, "pitch": pitch, "reverb": reverb, "echo": echo, "distortion": distortion] }
}
