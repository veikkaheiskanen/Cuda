import SwiftUI
import AppKit

struct AudioView: View {
    @ObservedObject var player: Player
    private var fullEffects: Bool { true }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Header(title: "Audio", subtitle: "Shape the sound, keep the music close").padding(.horizontal, 28).padding(.top, 28)
            Form {
                Section("Equalizer") {
                    Menu("Preset") {
                        Button("Flat") { player.effects = Effects() }
                        Button("Warm") { player.effects.low = 4; player.effects.mid = -1; player.effects.high = -2 }
                        Button("Vocal") { player.effects.low = -2; player.effects.mid = 4; player.effects.high = 1 }
                        Button("Bright") { player.effects.low = -1; player.effects.mid = 0; player.effects.high = 4 }
                    }.disabled(!fullEffects)
                    effectSlider("Bass", value: $player.effects.low, range: -12...12, suffix: "dB").disabled(!fullEffects)
                    effectSlider("Mid", value: $player.effects.mid, range: -12...12, suffix: "dB").disabled(!fullEffects)
                    effectSlider("Treble", value: $player.effects.high, range: -12...12, suffix: "dB").disabled(!fullEffects)
                }
                Section("Playback") {
                    effectSlider("Speed", value: $player.effects.speed, range: 0.5...2, suffix: "×")
                    effectSlider("Pitch", value: $player.effects.pitch, range: -12...12, suffix: "st").disabled(!fullEffects)
                    effectSlider("Volume", value: Binding(get: { Double(player.volume) * 100 }, set: { player.volume = Float($0 / 100) }), range: 0...100, suffix: "%")
                }
                Section("Effects") {
                    effectSlider("Reverb", value: $player.effects.reverb, range: 0...100, suffix: "%").disabled(!fullEffects)
                    effectSlider("Echo", value: $player.effects.echo, range: 0...100, suffix: "%").disabled(!fullEffects)
                    effectSlider("Distortion", value: $player.effects.distortion, range: 0...100, suffix: "%").disabled(!fullEffects)
                    Button("Reset audio") { player.effects = Effects() }
                }
                if !fullEffects { Text("Public streams support volume and speed. Equalizer, pitch and effects are available for Spotify and imported audio.").font(.callout).foregroundStyle(.secondary) }
            }.formStyle(.grouped).scrollContentBackground(.hidden)
        }
    }
    private func effectSlider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, suffix: String) -> some View {
        HStack { Text(title).frame(width: 80, alignment: .leading); Slider(value: value, in: range).accessibilityLabel(title); Text(String(format: suffix == "×" ? "%.2f%@" : "%.0f %@", value.wrappedValue, suffix)).monospacedDigit().foregroundStyle(.secondary).frame(width: 60, alignment: .trailing) }
    }
}
struct SettingsView: View {
    @ObservedObject var store: Store
    @AppStorage("native-theme") private var theme = "system"
    @AppStorage("native-transparency") private var transparency = true
    @AppStorage("native-glass-tint") private var tint = 0.0
    @State private var client = ""
    @State private var selecting = false
    @State private var about = false
    @State private var username = ""
    @State private var apiKey = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Header(title: "Settings").padding(.horizontal, 28).padding(.top, 28)
            Form {
                StreamingSettings()
                Section("Appearance") {
                    Picker("Theme", selection: $theme) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }
                    Toggle("Window transparency", isOn: $transparency)
                    HStack { Text("Glass tint"); Slider(value: $tint, in: 0...100); Text("\(Int(tint))%").monospacedDigit().frame(width: 48, alignment: .trailing) }
                }
                Section("Spotify") {
                    TextField("Client ID", text: $client)
                    HStack {
                        Button(store.spotify.connected ? "Reconnect library" : "Connect library") { Task { await store.connectSpotify(client) } }.disabled(store.syncing)
                        Button(store.spotify.playbackConnected ? "Reconnect playback" : "Connect playback") { Task { await store.connectSpotify(client, playback: true) } }.disabled(!store.spotify.connected || store.syncing)
                        if store.syncing { ProgressView().controlSize(.small) }
                    }
                    Text(store.spotify.connected ? store.spotify.playbackConnected ? "Spotify library and playback are connected." : "Library connected. Connect playback to listen through Cuda’s native audio engine." : "Add your Spotify app Client ID. Register http://127.0.0.1:8898/callback as its redirect URI. Native playback has a separate sign-in.").font(.callout).foregroundStyle(.secondary)
                    Button("Import Spotify playlists", systemImage: "square.stack") { selecting = true }.disabled(!store.spotify.connected)
                    Link("Spotify app setup", destination: URL(string: "https://developer.spotify.com/dashboard")!)
                    if store.spotify.connected { Button("Disconnect Spotify", role: .destructive) { Task { do { if store.player.current?.platform == "spotify" { store.player.stop() }; store.spotify = try await store.runtime.spotify("disconnect") } catch { store.message = error.localizedDescription } } } }
                }
                Section("Last.fm") {
                    TextField("Username", text: $username)
                    SecureField("API key", text: $apiKey)
                    Button("Save listening history connection") { Task { do { store.spotify = try await store.runtime.spotify("lastfm", [username, apiKey]); store.notice = "Last.fm connection saved." } catch { store.message = error.localizedDescription } } }
                    Text("Adds your Last.fm taste to Spotify’s weekly discovery picks.").font(.callout).foregroundStyle(.secondary)
                }
                MacSyncSettings(sync: store.deviceSync)
                DiscordSettings(presence: store.discord)
                LyricsSettings(runtime: store.runtime)
                Section("Your Shelf") { Button("Export Shelf backup", systemImage: "square.and.arrow.up") { store.exportShelf() }; Button("Import Shelf backup", systemImage: "square.and.arrow.down") { store.importShelf() } }
                UpdateSettings()
                Section("About") {
                    Link("built by veikkaheiskanen", destination: URL(string: "https://github.com/veikkaheiskanen")!)
                    LabeledContent("Cuda Native", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.10")
                    Button("About Cuda") { about = true }
                }
            }.formStyle(.grouped).scrollContentBackground(.hidden)
        }.onAppear { client = store.spotify.clientId; username = store.spotify.lastfm?.username ?? ""; apiKey = store.spotify.lastfm?.apiKey ?? "" }
            .onChange(of: theme) { _, value in Appearance.apply(value) }
            .sheet(isPresented: $selecting) { SpotifyPicker(store: store) }
            .sheet(isPresented: $about) { AboutView() }
    }
}
struct DiscordSettings: View {
    @ObservedObject var presence: DiscordPresenceController
    @State private var applicationID = ""
    var body: some View {
        Section("Discord") {
            Toggle("Share listening activity", isOn: $presence.enabled).disabled(!presence.validID)
            TextField("Application ID", text: $applicationID)
            HStack {
                Button("Save Application ID") { presence.saveApplicationID(applicationID) }
                Link("Discord Developer Portal", destination: URL(string: "https://discord.com/developers/applications")!)
            }
            Text("Create an application named Cuda in the Developer Portal, then copy its Application ID here. No bot or account token is needed.").font(.callout).foregroundStyle(.secondary)
            Text("When enabled, your song, artist and public artwork appear on your Discord profile. Keep the Discord desktop app open and activity sharing enabled.").font(.callout).foregroundStyle(.secondary)
            LabeledContent("Status", value: presence.status)
        }.onAppear { applicationID = presence.applicationID }
    }
}
struct SpotifyPicker: View {
    @ObservedObject var store: Store
    @State private var selected = Set<String>()
    @State private var link = ""
    @State private var client = ""
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { Text("Import from Spotify").font(.title2.bold()); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
            if !store.spotify.connected {
                Text("Connect your Spotify library to choose playlists or import a link. Playback sign-in is separate and optional for importing.").foregroundStyle(.secondary)
                TextField("Spotify app Client ID", text: $client)
                Button("Connect Spotify library") { Task { await store.connectSpotify(client); if store.spotify.connected { await store.loadChoices() } } }.disabled(store.syncing)
                Link("Spotify app setup", destination: URL(string: "https://developer.spotify.com/dashboard")!)
                Text("Register http://127.0.0.1:8898/callback as the redirect URI.").font(.callout).foregroundStyle(.secondary)
                Spacer()
            } else {
                Text("Import selected playlists to Shelf and use their songs for recommendations. Existing imports update without creating duplicates.").foregroundStyle(.secondary)
                HStack { TextField("Spotify playlist link or URI", text: $link); Button("Import link") { Task { await importLink() } }.disabled(store.syncing || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                if let error { Text(error).font(.callout).foregroundStyle(.red) }
                List(store.choices) { choice in
                    Toggle(isOn: Binding(get: { selected.contains(choice.id) }, set: { if $0 { selected.insert(choice.id) } else { selected.remove(choice.id) } })) {
                        VStack(alignment: .leading, spacing: 3) { Text(choice.name); Text(choice.accessible == false ? "Spotify restricts access to this playlist" : choice.owner ?? "Your playlist").font(.caption).foregroundStyle(.secondary) }
                    }.disabled(choice.accessible == false)
                }
                Text("Spotify permits playlist contents for playlists you own or collaborate on. Imported playlists copy to a paired iPhone through Device sync.").font(.callout).foregroundStyle(.secondary)
                HStack { Button("Refresh list", systemImage: "arrow.clockwise") { Task { await store.loadChoices() } }.disabled(store.syncing); Spacer(); Button("Import selected") { Task { if await store.sync(selected) { dismiss() } } }.buttonStyle(.borderedProminent).disabled(store.syncing || selected.isEmpty) }
            }
            if store.syncing { HStack { ProgressView().controlSize(.small); Text("Fetching Spotify playlists…").font(.callout).foregroundStyle(.secondary) } }
        }.padding(24).frame(width: 510, height: 570).task { client = store.spotify.clientId; selected = Set(store.spotify.selected); if store.spotify.connected { await store.loadChoices() } }
    }
    private func importLink() async {
        error = nil
        guard let id = SpotifyPlaylistLink.id(link) else { error = "Paste a Spotify playlist link or spotify:playlist: URI."; return }
        if store.choices.isEmpty { await store.loadChoices() }
        guard let choice = store.choices.first(where: { $0.id == id }), choice.accessible != false else { error = "Choose a playlist you own or collaborate on using this Spotify account."; return }
        if await store.sync(Set(store.spotify.selected).union([id])) { dismiss() }
    }
}

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Cuda").font(.largeTitle.bold())
            Text("A native music player for Apple Silicon.").foregroundStyle(.secondary)
            Link("built by veikkaheiskanen", destination: URL(string: "https://github.com/veikkaheiskanen")!)
            Text("powered on:")
            Link("Riff by rootless", destination: URL(string: "https://github.com/rootscripts/riff")!)
            Link("Deck by jarilehtinen", destination: URL(string: "https://github.com/jarilehtinen/deck")!)
            Text("SwiftUI · AppKit · AVFoundation · Rust").font(.callout).foregroundStyle(.secondary)
            Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
        }.padding(28).frame(width: 350)
    }
}
enum Appearance {
    static func apply(_ value: String) { NSApp.appearance = value == "dark" ? NSAppearance(named: .darkAqua) : value == "light" ? NSAppearance(named: .aqua) : nil }
}
