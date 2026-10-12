import SwiftUI

struct AudioSettingsView: View {
    @ObservedObject var player: Player
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                if player.usesSpotify {
                    Section {
                        Label("Spotify handles this audio", systemImage: "music.note")
                        Text("Use the equalizer in Spotify's Settings → Playback. Cuda's EQ and speed controls apply to imported audio, downloaded playlists and supported public streams. Sleep timer needs audio playing in Cuda.").foregroundStyle(.secondary)
                    }
                }
                Section {
                    Toggle("Equalizer", isOn: $player.effects.enabled).disabled(!player.equalizerAvailable || player.usesSpotify)
                    Text(player.equalizerStatus).font(.subheadline).foregroundStyle(.secondary)
                    if player.equalizerAvailable && !player.usesSpotify {
                        Picker("Preset", selection: Binding(get: { AudioSettings.presets.first { $0.1 == player.effects.gains }?.0 ?? "Custom" }, set: { value in
                            if let preset = AudioSettings.presets.first(where: { $0.0 == value }) { player.effects.gains = preset.1; player.effects.enabled = true }
                        })) {
                            ForEach(AudioSettings.presets, id: \.0) { Text($0.0).tag($0.0) }; Text("Custom").tag("Custom")
                        }
                        ForEach(AudioSettings.frequencies.indices, id: \.self) { index in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(frequency(AudioSettings.frequencies[index]))
                                    Spacer()
                                    Text(String(format: "%+.0f dB", player.effects.gains[index])).monospacedDigit().foregroundStyle(.secondary)
                                }
                                Slider(value: $player.effects.gains[index], in: -12...12, step: 1).accessibilityLabel(frequency(AudioSettings.frequencies[index]))
                            }.disabled(!player.effects.enabled)
                        }
                    }
                } header: { Text("Equalizer") } footer: {
                    Text("Cuda keeps headroom when boosting a band to reduce distortion. Some live streams cannot expose their audio for EQ; downloaded audio can.")
                }
                Section("Playback") {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack { Text("Speed"); Spacer(); Text(String(format: "%.2f×", player.effects.speed)).monospacedDigit().foregroundStyle(.secondary) }
                        Slider(value: $player.effects.speed, in: 0.5...2, step: 0.05).accessibilityLabel("Playback speed").disabled(player.usesSpotify)
                    }
                    if !player.usesSpotify {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack { Text("Cuda volume"); Spacer(); Text("\(Int(player.volume * 100))%").monospacedDigit().foregroundStyle(.secondary) }
                            Slider(value: $player.volume, in: 0...1).accessibilityLabel("Cuda volume")
                        }
                    }
                    HStack { Text("Device volume"); SystemVolume().frame(maxWidth: 220).frame(height: 32) }
                    Menu {
                        ForEach([15, 30, 45, 60], id: \.self) { minutes in Button("\(minutes) minutes") { player.sleep(after: minutes) } }
                        if player.sleepDeadline != nil { Button("Turn off", role: .destructive) { player.sleep(after: nil) } }
                    } label: {
                        HStack { Label("Sleep timer", systemImage: "moon.zzz"); Spacer(); if let date = player.sleepDeadline { Text(date, style: .time) } else { Text("Off") } }
                    }
                    .disabled(player.usesSpotify)
                    Button("Reset audio settings") { player.effects = AudioSettings(); player.volume = 1; player.sleep(after: nil) }
                }
            }.navigationTitle("Audio").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                #if DEBUG
                if ProcessInfo.processInfo.environment["CUDA_PREVIEW_AUDIO"] == "1" {
                    try? await Task.sleep(for: .seconds(2))
                    let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    try? Data("ready".utf8).write(to: root.appendingPathComponent("preview-audio-ready"))
                }
                #endif
            }
        }
    }
    private func frequency(_ value: Double) -> String { value < 1000 ? "\(Int(value)) Hz" : String(format: "%.1f kHz", value / 1000) }
}
