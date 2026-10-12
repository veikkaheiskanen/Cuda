import Foundation
import AVFoundation
import MediaToolbox
import AudioToolbox

struct AudioSettings: Codable, Equatable {
    static let frequencies: [Double] = [60, 230, 910, 3600, 14000]
    var enabled = false
    var gains = [Double](repeating: 0, count: 5)
    var speed: Float = 1
    static let presets: [(String, [Double])] = [
        ("Flat", [0, 0, 0, 0, 0]), ("Bass", [6, 4, 0, -1, 0]),
        ("Vocal", [-2, -1, 3, 4, 1]), ("Warm", [3, 2, 0, -2, -3])
    ]
}

// Float PCM, with independent filter state for each channel. The same processor
// is tested offline and used by AVPlayer's post-effects audio tap.
final class EqualizerProcessor {
    private let lock = NSLock()
    private var settings = AudioSettings()
    private var rate = 44100.0
    private var coefficients = [[Double]](repeating: [1, 0, 0, 0, 0], count: 5)
    private var memory = [Double](repeating: 0, count: 8 * 5 * 2)
    private var headroom = 1.0
    func update(_ value: AudioSettings) {
        lock.lock(); defer { lock.unlock() }
        settings = value; rebuild()
    }
    func prepare(rate: Double) {
        lock.lock(); defer { lock.unlock() }; self.rate = max(rate, 8000)
        memory = [Double](repeating: 0, count: memory.count); rebuild()
    }
    private func rebuild() {
        let gains = AudioSettings.frequencies.indices.map { i in settings.gains.indices.contains(i) ? max(-12, min(12, settings.gains[i])) : 0 }
        headroom = pow(10, -max(0, gains.max() ?? 0) / 20)
        coefficients = AudioSettings.frequencies.enumerated().map { index, frequency in
            let a = pow(10, gains[index] / 40), w = 2 * Double.pi * min(frequency, rate * 0.45) / rate
            let alpha = sin(w) / 2, c = cos(w), denominator = 1 + alpha / a
            return [(1 + alpha * a) / denominator, -2 * c / denominator, (1 - alpha * a) / denominator, -2 * c / denominator, (1 - alpha / a) / denominator]
        }
    }
    func process(_ samples: UnsafeMutablePointer<Float>, frames: Int, channels: Int, channelOffset: Int = 0) {
        guard lock.try() else { return }; defer { lock.unlock() }
        guard settings.enabled, channels > 0, channels + channelOffset <= 8 else { return }
        for frame in 0..<frames {
            for channel in 0..<channels {
                var x = Double(samples[frame * channels + channel]) * headroom
                for band in 0..<5 {
                    let i = ((channel + channelOffset) * 5 + band) * 2, b = coefficients[band]
                    let y = b[0] * x + memory[i]
                    memory[i] = b[1] * x - b[3] * y + memory[i + 1]
                    memory[i + 1] = b[2] * x - b[4] * y; x = y
                }
                samples[frame * channels + channel] = Float(max(-1, min(1, x)))
            }
        }
    }
}

final class PlayerAudioTap {
    let processor: EqualizerProcessor
    private var format = AudioStreamBasicDescription()
    private let onActive: (Bool) -> Void
    private var reported = false
    init(_ processor: EqualizerProcessor, onActive: @escaping (Bool) -> Void) { self.processor = processor; self.onActive = onActive }
    private func prepare(_ format: AudioStreamBasicDescription) {
        self.format = format; reported = false; processor.prepare(rate: format.mSampleRate)
    }
    private func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        let supported = format.mFormatID == kAudioFormatLinearPCM && format.mFormatFlags & kAudioFormatFlagIsFloat != 0 && format.mBitsPerChannel == 32 && format.mChannelsPerFrame <= 8
        if !reported { reported = true; onActive(supported) }
        guard supported else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        var offset = 0
        for buffer in list {
            guard let data = buffer.mData else { continue }
            let channels = Int(buffer.mNumberChannels)
            let count = min(frames, Int(buffer.mDataByteSize) / max(channels * MemoryLayout<Float>.size, 1))
            processor.process(data.assumingMemoryBound(to: Float.self), frames: count, channels: channels, channelOffset: offset)
            offset += channels
        }
    }
    func create() throws -> MTAudioProcessingTap {
        var callbacks = MTAudioProcessingTapCallbacks(version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: Unmanaged.passRetained(self).toOpaque(),
            init: { _, client, storage in storage.pointee = client },
            finalize: { tap in Unmanaged<PlayerAudioTap>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release() },
            prepare: { tap, _, format in Unmanaged<PlayerAudioTap>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().prepare(format.pointee) },
            unprepare: { _ in },
            process: { tap, frames, _, buffers, outputFrames, flags in
                guard MTAudioProcessingTapGetSourceAudio(tap, frames, buffers, flags, nil, outputFrames) == noErr else { outputFrames.pointee = 0; return }
                Unmanaged<PlayerAudioTap>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().process(buffers, frames: Int(outputFrames.pointee))
            })
        var tap: MTAudioProcessingTap?
        let status = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap)
        guard status == noErr, let tap else {
            Unmanaged<PlayerAudioTap>.fromOpaque(callbacks.clientInfo!).release()
            throw CudaError.message("Equalizer is unavailable for this audio format.")
        }
        return tap
    }
}
