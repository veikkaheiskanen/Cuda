import AVFoundation
import Foundation

@main
struct AudioChecks {
    @MainActor static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let graph = LocalAudio()
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        try graph.engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 1024)
        try graph.load(url)
        func render() throws -> Double {
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!
            var sum = 0.0, count = 0
            for block in 0..<80 {
                _ = try graph.engine.renderOffline(1024, to: buffer)
                if block > 20, let samples = buffer.floatChannelData {
                    for index in 0..<Int(buffer.frameLength) { sum += Double(samples[0][index] * samples[0][index]); count += 1 }
                }
            }
            return sqrt(sum / Double(max(1, count)))
        }
        let flat = try render()
        var effects = Effects(); effects.low = 12; effects.mid = 12; effects.high = 12
        graph.apply(effects, volume: 1); graph.seek(0, play: true)
        let boosted = try render()
        print("Rendered RMS: flat=\(flat), EQ=\(boosted)")
        precondition(flat > 0.001, "Audio must contain audible samples")
        precondition(boosted > flat * 1.15, "Equalizer must change the rendered audio")
        effects.pitch = 2; effects.speed = 1.25; effects.echo = 25
        graph.apply(effects, volume: 0.4)
        precondition(graph.pitch.pitch == 200 && graph.pitch.rate == 1.25 && graph.delay.wetDryMix == 25 && graph.node.volume == 0.4)
        graph.seek(3, play: true); _ = try render()
        precondition(graph.position >= 3 && graph.position < graph.duration)
        graph.pause(); precondition(!graph.playing); graph.resume(); precondition(graph.playing)
        graph.stop(); precondition(!graph.playing)
        print("PASS: rendered local audio, audible EQ gain, pitch/speed/echo/volume, seek, pause/resume and stop")
    }
}
