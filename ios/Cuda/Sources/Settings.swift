import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: Store
    @ObservedObject var spotify: Spotify
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("spotifyClientID") private var clientID = ""
    @State private var selecting = false
    var body: some View {
        Form {
            DeviceSyncSettings(sync: store.deviceSync)
            Section("Appearance") {
                Picker("Theme", selection: $appearance) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }
            }
            Section {
                TextField("Spotify Client ID", text: $clientID).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(spotify.connected ? "Reconnect Spotify" : "Connect Spotify", systemImage: "link") {
                    do { try spotify.connect() } catch { store.message = error.localizedDescription }
                }
                Text(spotify.message).font(.subheadline).foregroundStyle(.secondary)
                Button("Choose playlists", systemImage: "square.stack") { selecting = true }.disabled(!spotify.hasToken)
                if spotify.hasToken { Button("Disconnect Spotify", role: .destructive) { spotify.disconnect(); if store.player.current?.platform == "spotify" { store.player.playing = false; store.player.loading = false } } }
            } header: { Text("Spotify") } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Install Spotify and sign in on this device. Register an iOS app with bundle ID com.veikkaheiskanen.Cuda and redirect URI cuda-spotify://callback. Add its Client ID above. On-demand playback requires Premium.")
                    Link("Open Spotify Developer Dashboard", destination: URL(string: "https://developer.spotify.com/dashboard")!)
                }
            }
            CompanionSettings(sync: store.deviceSync)
            Section("About") {
                Link("built by veikkaheiskanen", destination: URL(string: "https://github.com/veikkaheiskanen")!)
                LabeledContent("Cuda for iOS", value: "1.1.1")
                Link("Source & setup", destination: URL(string: "https://github.com/veikkaheiskanen/Cuda/tree/main/ios")!)
                Text("powered on:").foregroundStyle(.secondary)
                Link("Riff by rootless", destination: URL(string: "https://github.com/rootscripts/riff")!)
                Link("Deck by jarilehtinen", destination: URL(string: "https://github.com/jarilehtinen/deck")!)
            }
        }.navigationTitle("Settings")
            .sheet(isPresented: $selecting) { SpotifyPlaylistPicker(store: store) }
    }
}
struct CompanionSettings: View {
    @ObservedObject var sync: DeviceSync
    @AppStorage("companionManualOverride") private var manual = false
    @State private var address = UserDefaults.standard.string(forKey: "companionAddress") ?? ""
    @State private var token = Keychain.read("companion")
    @State private var connectionStatus = ""
    @State private var testing = false
    var body: some View {
        Section {
            Label(manual ? "Using a custom companion" : sync.playback != nil ? "Connected through Device sync" : "Connect with Device sync above", systemImage: manual || sync.playback != nil ? "checkmark.circle" : "link")
            Text(manual ? connectionStatus : sync.playbackStatus).font(.subheadline).foregroundStyle(.secondary)
            if sync.pairing != nil {
                Button(manual ? "Use Device sync connection" : "Refresh connection", systemImage: "arrow.clockwise") {
                    manual = false; Task { await sync.refreshPlaybackConnection() }
                }
            }
            DisclosureGroup("Advanced companion setup") {
                TextField("Companion address", text: $address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Pairing key", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button { Task { await pair() } } label: { HStack { Text("Connect custom companion"); if testing { Spacer(); ProgressView() } } }.disabled(testing)
                if !connectionStatus.isEmpty { Text(connectionStatus).font(.subheadline).foregroundStyle(.secondary) }
                Text("For a standalone companion or an older Mac build. Automatic pairing needs Cuda 1.0.6 or later on your Mac.").font(.footnote).foregroundStyle(.secondary)
            }
        } header: { Text("YouTube & SoundCloud") } footer: {
            Text("Device sync connects YouTube, YouTube Music and SoundCloud automatically. No extra address, key or command is needed. Keep Cuda open on an awake Mac on the same trusted Wi-Fi. Playback streams use the local network; Shelf syncing and connection setup use encrypted TLS.")
        }
    }
    private func pair() async {
        guard Companion.validAddress(address), token.count >= 32 else { connectionStatus = "Enter the local address and full pairing key shown on your Mac."; return }
        testing = true; defer { testing = false }
        do {
            struct Health: Decodable { var service: String }
            let companion = Companion(address: address, token: token)
            let result: Health = try await companion.request("/health")
            guard result.service == "cuda-ios-companion" else { throw CudaError.message("This address is not a Cuda companion.") }
            try Keychain.write(token, account: "companion")
            UserDefaults.standard.set(address, forKey: "companionAddress")
            manual = true
            connectionStatus = "Paired. YouTube and SoundCloud are ready."
        } catch { connectionStatus = error.localizedDescription }
    }
}
struct SpotifyPlaylistPicker: View {
    @ObservedObject var store: Store
    @State private var selected = Set<String>()
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section { Text("Choose the playlists you want on Shelf. Their songs also shape your recommendations.").foregroundStyle(.secondary) }
                ForEach(store.spotifyChoices) { playlist in
                    Button {
                        guard let id = playlist.spotifyID else { return }
                        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
                    } label: {
                        HStack { Text(playlist.name).foregroundStyle(.primary); Spacer(); Image(systemName: selected.contains(playlist.spotifyID ?? "") ? "checkmark.circle.fill" : "circle") }
                    }
                }
                if store.syncing { ProgressView("Fetching playlists…") }
            }.navigationTitle("Choose playlists").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Sync") { Task { if await store.syncSpotify(selected) { dismiss() } } }.disabled(store.syncing) } }
                .task { selected = Set(store.state.selectedSpotify); await store.loadSpotifyPlaylists() }
                .alert("Spotify", isPresented: Binding(get: { store.message != nil }, set: { if !$0 { store.message = nil } })) { Button("OK") { store.message = nil } } message: { Text(store.message ?? "") }
        }
    }
}
