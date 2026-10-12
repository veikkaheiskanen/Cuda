import XCTest
@testable import Cuda

final class AudioHistoryTests: XCTestCase {
    func testEQProcessesSamplesAndKeepsStereoChannelsIndependent() {
        func energy(_ frequency: Double, _ gains: [Double]) -> Double {
            let processor = EqualizerProcessor(); var settings = AudioSettings(); settings.enabled = true; settings.gains = gains
            processor.update(settings); processor.prepare(rate: 48000)
            var samples = [Float](repeating: 0, count: 96000)
            let step = 2 * Double.pi * frequency / 48000
            for frame in 0..<48000 { samples[frame * 2] = Float(0.2 * sin(step * Double(frame))) }
            samples.withUnsafeMutableBufferPointer { processor.process($0.baseAddress!, frames: 48000, channels: 2) }
            XCTAssertTrue(samples.allSatisfy { $0.isFinite && abs($0) <= 1 })
            XCTAssertTrue(stride(from: 1, to: samples.count, by: 2).allSatisfy { samples[$0] == 0 })
            var sum = 0.0
            for frame in 24000..<48000 { sum += pow(Double(samples[frame * 2]), 2) }
            return sqrt(sum / 24000)
        }
        let flat = energy(60, [0,0,0,0,0]); XCTAssertEqual(flat, 0.2 / sqrt(2), accuracy: 0.0001)
        XCTAssertGreaterThan(energy(60, [6,0,0,0,0]), energy(14000, [6,0,0,0,0]) * 1.8)
        XCTAssertLessThan(energy(910, [0,0,-12,0,0]), flat * 0.3)
        _ = energy(910, [12,12,12,12,12])
    }
    func testSongSwitchesMergeWithoutHistoryEchoOrFavouriteLeak() throws {
        let a = Track(id: "a", title: "First", artist: "Cuda Sessions", platform: "youtube", url: "https://youtube.com/watch?v=a")
        let b = Track(id: "b", title: "Second", artist: "Cuda Sessions", platform: "youtube", url: "https://youtube.com/watch?v=b")
        var mac = ShelfSyncJournal(), phone = ShelfSyncJournal(), state = CollectionState()
        mac.played(a); mac.played(b)
        phone.merge(Array(mac.records.values)); phone.apply(to: &state)
        XCTAssertEqual(state.history.map(\.id), ["b","a"]); XCTAssertTrue(state.favourites.isEmpty)
        let revisions = phone.records; phone.capture(state); phone.apply(to: &state); phone.capture(state)
        XCTAssertEqual(phone.records, revisions)
        phone.played(a); mac.merge(Array(phone.records.values)); mac.apply(to: &state)
        XCTAssertEqual(state.history.map(\.id), ["a","b"])
        var restored = try JSONDecoder().decode(ShelfSyncJournal.self, from: JSONEncoder().encode(mac))
        restored.capture(state); XCTAssertEqual(restored.records, mac.records)
    }
    @MainActor
    func testSleepTimerDoesNotPretendToControlSpotifyInTheBackground() {
        let player = Player(spotify: Spotify(), localRoot: FileManager.default.temporaryDirectory, companion: { Companion(address: "", token: "") })
        player.current = Track(id: String(repeating: "a", count: 22), title: "Fixture", artist: "Cuda Sessions", platform: "spotify", url: "")
        player.sleep(after: 15); XCTAssertNil(player.sleepDeadline)
        player.current = nil; player.sleep(after: 15); XCTAssertNotNil(player.sleepDeadline)
        player.sleep(after: nil); XCTAssertNil(player.sleepDeadline)
    }
    func testSpotifyRecoveryDoesNotExposeRawAuthorizationOrUnknownErrors() {
        let error = NSError(domain: "Spotify", code: -1000, userInfo: [NSLocalizedDescriptionKey: "unknown error secret-token"])
        let message = SpotifyRecovery.connection(error)
        XCTAssertTrue(message.contains("-1000")); XCTAssertTrue(message.contains("Settings")); XCTAssertFalse(message.contains("unknown error")); XCTAssertFalse(message.contains("secret-token"))
        XCTAssertTrue(SpotifyRecovery.authorization("invalid redirect").contains("cuda-spotify://callback"))
        XCTAssertTrue(SpotifyRecovery.authorization("access denied").contains("cancelled"))
    }
}
