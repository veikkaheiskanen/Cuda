import Foundation

// Bound decoded audio to three seconds. Pausing or slowing playback applies
// backpressure to the decoder instead of downloading a whole song into memory.
final class StreamDecoder: @unchecked Sendable {
    private let child = Process()
    private let condition = NSCondition()
    private var queuedFrames = 0
    private var stopped = false
    var buffer: ((Data, @escaping () -> Void) -> Void)?
    var finished: ((Bool) -> Void)?

    func start(url: URL, binary: URL, offset: Double) throws {
        let output = Pipe(), errors = Pipe()
        child.executableURL = binary
        child.arguments = ["-nostdin", "-loglevel", "error", "-ss", String(max(0, offset)), "-i", url.absoluteString, "-vn", "-f", "f32le", "-ac", "2", "-ar", "44100", "pipe:1"]
        child.standardOutput = output; child.standardError = errors
        errors.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        try child.run()
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            var pending = Data()
            while !isStopped {
                guard let bytes = try? output.fileHandleForReading.read(upToCount: 16384), !bytes.isEmpty else { break }
                pending.append(bytes)
                while pending.count >= 16384 && !isStopped {
                    let frames = 2048, chunk = Data(pending.prefix(16384)); pending.removeFirst(16384)
                    enqueue(chunk, frames: frames)
                }
            }
            if !isStopped && !pending.isEmpty {
                let count = pending.count / 8 * 8
                if count > 0 { enqueue(Data(pending.prefix(count)), frames: count / 8) }
            }
            child.waitUntilExit()
            condition.lock()
            while queuedFrames > 0 && !stopped { condition.wait() }
            let cancelled = stopped
            condition.unlock()
            if !cancelled { finished?(child.terminationStatus == 0) }
        }
    }
    private var isStopped: Bool { condition.lock(); defer { condition.unlock() }; return stopped }
    private func enqueue(_ data: Data, frames: Int) {
        condition.lock()
        while queuedFrames >= 132300 && !stopped { condition.wait() }
        if stopped { condition.unlock(); return }
        queuedFrames += frames; condition.unlock()
        buffer?(data, { [weak self] in
            guard let self else { return }
            self.condition.lock(); self.queuedFrames = max(0, self.queuedFrames - frames); self.condition.broadcast(); self.condition.unlock()
        })
    }
    func stop() {
        condition.lock(); stopped = true; condition.broadcast(); condition.unlock()
        if child.isRunning { child.terminate() }
    }
}
