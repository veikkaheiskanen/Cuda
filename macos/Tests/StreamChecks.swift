import AVFoundation
import Foundation

@main
struct StreamChecks {
    @MainActor static func main() async throws {
        let graph = LocalAudio()
        var ready = false, failed = false
        graph.streamReady = { ready = true }; graph.streamFailed = { failed = true }
        try graph.loadStream(URL(string: CommandLine.arguments[1])!, binary: URL(fileURLWithPath: CommandLine.arguments[2]), duration: 0)
        graph.apply(Effects(), volume: 0)
        for _ in 0..<80 { if ready || failed { break }; try await Task.sleep(for: .milliseconds(100)) }
        precondition(ready && !failed && graph.loaded && graph.duration == 0, "Streams with unknown duration must be ready to resume")
        try await Task.sleep(for: .seconds(1)); precondition(graph.position > 0.5 && graph.playing)
        graph.pause(); let paused = graph.position
        try await Task.sleep(for: .milliseconds(400)); precondition(abs(graph.position - paused) < 0.15)
        graph.resume(); try await Task.sleep(for: .milliseconds(500)); precondition(graph.position > paused)
        var effects = Effects(); effects.mid = 5; effects.pitch = 2; effects.speed = 1.2
        graph.apply(effects, volume: 0); precondition(graph.eq.bands[1].gain == 5 && graph.pitch.pitch == 200 && graph.pitch.rate == 1.2)
        ready = false; graph.seek(5, play: true)
        for _ in 0..<80 { if ready || failed { break }; try await Task.sleep(for: .milliseconds(100)) }
        precondition(ready && !failed && graph.position >= 5)
        graph.stop(); precondition(!graph.playing)
        print("PASS: HTTP audio decoding, bounded buffering, Apple audio output, pause/resume, EQ/pitch/speed, seek and decoder shutdown")
    }
}
