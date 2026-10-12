import SwiftUI
import UniformTypeIdentifiers
import MediaPlayer
import AVKit

enum Page: String, CaseIterable, Identifiable {
    case home = "Home", search = "Search", shelf = "Shelf", settings = "Settings"
    var id: String { rawValue }
    var symbol: String { switch self { case .home: return "house"; case .search: return "magnifyingglass"; case .shelf: return "square.stack"; case .settings: return "gearshape" } }
}
struct RootView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var page = Page.home
    @State private var expanded = false
    @State private var playerDetent: PresentationDetent = .large
    var body: some View {
        Group {
            if sizeClass == .regular {
                NavigationSplitView {
                    List(Page.allCases) { item in
                        Button { page = item } label: { Label(item.rawValue, systemImage: item.symbol).foregroundStyle(page == item ? Color.accentColor : Color.primary) }
                            .listRowBackground(page == item ? Color.accentColor.opacity(0.1) : Color.clear)
                    }.navigationTitle("Cuda")
                } detail: { navigation(page) }
            } else {
                TabView(selection: $page) {
                    ForEach(Page.allCases) { item in
                        navigation(item).tabItem { Label(item.rawValue, systemImage: item.symbol) }.tag(item)
                    }
                }
            }
        }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.environment["CUDA_DEMO"] == "1" {
                store.seedPreview()
                if ProcessInfo.processInfo.environment["CUDA_PREVIEW_PLAYER"] == "1", let track = store.state.history.first {
                    player.play(track, in: store.state.history)
                    expanded = true
                }
                try? await Task.sleep(for: .seconds(2))
                let marker = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("preview-ready")
                try? Data("ready".utf8).write(to: marker)
            }
            #endif
        }
        .sheet(isPresented: $expanded) { NowPlaying(store: store, player: player).presentationDetents([.medium, .large], selection: $playerDetent).presentationDragIndicator(.visible) }
        .alert("Cuda", isPresented: Binding(get: { store.message != nil || player.error != nil }, set: { if !$0 { store.message = nil; player.error = nil } })) {
            Button("OK", role: .cancel) { store.message = nil; player.error = nil }
        } message: { Text(store.message ?? player.error ?? "") }
    }
    private func navigation(_ item: Page) -> some View {
        NavigationStack {
            Group {
                switch item {
                case .home: HomeView(store: store, player: player)
                case .search: SearchView(store: store, player: player)
                case .shelf: ShelfView(store: store, player: player)
                case .settings: SettingsView(store: store, spotify: store.spotify)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                PlayerDock(player: player, spotify: store.spotify, expand: { expanded = true })
            }
        }
    }
}
struct Cover: View {
    var track: Track?
    var image: UIImage? = nil
    var body: some View {
        Rectangle().fill(Color(uiColor: .tertiarySystemFill))
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                GeometryReader { geometry in
                    ZStack {
                        if let image { Image(uiImage: image).resizable().scaledToFill() }
                        else if let raw = track?.thumbnail, raw.hasPrefix("demo-") {
                            Image(raw).resizable().scaledToFill()
                        } else if let raw = track?.thumbnail, let url = URL(string: raw), url.scheme == "https" {
                            AsyncImage(url: url) { phase in
                                if let image = phase.image { image.resizable().scaledToFill() }
                                else { Image(systemName: "music.note").font(.title2).foregroundStyle(.secondary) }
                            }
                        } else { Image(systemName: "music.note").font(.title2).foregroundStyle(.secondary) }
                    }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous)).accessibilityHidden(true)
    }
}
struct TrackRow: View {
    var track: Track
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var queue: [Track]
    var body: some View {
        HStack(spacing: 12) {
            Button { player.play(track, in: queue) } label: {
                HStack(spacing: 12) {
                    Cover(track: track).frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(track.title).font(.body.weight(.medium)).lineLimit(2).foregroundStyle(.primary)
                        Text(track.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    if player.current?.key == track.key { Image(systemName: player.playing ? "waveform" : "pause.fill").foregroundStyle(Color.accentColor) }
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Play \(track.title), \(track.artist)")
            Menu {
                Button(store.state.favourites.contains(where: { $0.key == track.key }) ? "Remove favourite" : "Favourite", systemImage: "heart") { store.favourite(track) }
                Menu("Add to playlist", systemImage: "text.badge.plus") {
                    ForEach(store.state.playlists.filter { $0.spotifyID == nil }) { playlist in Button(playlist.name) { store.add(track, playlistID: playlist.id) } }
                }
                Button("Play next", systemImage: "text.line.first.and.arrowtriangle.forward") {
                    let index = player.queue.firstIndex(where: { $0.key == player.current?.key }).map { $0 + 1 } ?? 0
                    player.queue.insert(track, at: min(index, player.queue.count))
                }
            } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle()) }
            .accessibilityLabel("More options for \(track.title)")
        }.padding(.vertical, 4)
    }
}
struct HomeView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @State private var importing = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if store.state.history.isEmpty {
                    ContentUnavailableView {
                        Label("Make yourself at home", systemImage: "music.note")
                    } description: { Text("Bring your music to Cuda. Import audio or connect your streaming sources in Settings.") }
                    actions: { Button("Import audio", systemImage: "plus") { importing = true }.buttonStyle(.borderedProminent) }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Text("Last played").font(.title2.bold()); Spacer(); NavigationLink("View all") { TrackList(title: "Last played", tracks: store.state.history, store: store, player: player) } }
                        ForEach(Array(store.state.history.prefix(4)), id: \.key) { TrackRow(track: $0, store: store, player: player, queue: store.state.history) }
                    }
                }
                if !store.recommendations.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack { Text("For you").font(.title2.bold()); Spacer(); if store.refreshing { ProgressView() } else { Button("Refresh", systemImage: "arrow.clockwise") { Task { await store.refreshRecommendations() } }.labelStyle(.iconOnly).frame(width: 44, height: 44) } }
                        ScrollView(.horizontal) {
                            LazyHStack(alignment: .top, spacing: 16) {
                                ForEach(store.recommendations, id: \.key) { track in
                                    Button { player.play(track, in: store.recommendations) } label: {
                                        VStack(alignment: .leading, spacing: 8) { Cover(track: track).frame(width: 152, height: 152); Text(track.title).font(.headline).lineLimit(2); Text(track.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }.frame(width: 152, alignment: .leading)
                                    }.buttonStyle(.plain)
                                }
                            }
                        }.scrollIndicators(.hidden)
                    }
                }
                if !store.state.playlists.isEmpty { PlaylistShelf(store: store, player: player) }
            }.padding(20)
        }.navigationTitle("Cuda").refreshable { await store.refreshRecommendations() }
            .task { if store.recommendations.isEmpty { await store.refreshRecommendations() } }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.audio], allowsMultipleSelection: true) { result in if case .success(let urls) = result { Task { await store.importAudio(urls) } } }
    }
}
struct SearchView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @State private var query = ""
    var body: some View {
        List {
            if store.searching { HStack { ProgressView(); Text("Finding your music…").foregroundStyle(.secondary) } }
            ForEach(store.results, id: \.key) { track in TrackRow(track: track, store: store, player: player, queue: store.results) }
            if store.results.isEmpty && !store.searching {
                ContentUnavailableView(query.isEmpty ? "Find your next favourite" : "No songs found", systemImage: "magnifyingglass", description: Text(query.isEmpty ? "Search songs and artists across your connected sources." : "Try a different song or check your connections in Settings."))
            }
        }.listStyle(.plain).navigationTitle("Search").searchable(text: $query, prompt: "Songs, artists, or albums")
            .task(id: query) { await store.search(query) }
    }
}
struct ShelfView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @State private var importing = false
    @State private var creating = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Favourites").font(.title2.bold())
                    if store.state.favourites.isEmpty { Text("Tap the heart on a song to keep it here.").foregroundStyle(.secondary) }
                    else {
                        ScrollView(.horizontal) {
                            LazyHStack(alignment: .top, spacing: 16) {
                                ForEach(store.state.favourites, id: \.key) { track in
                                    Button { player.play(track, in: store.state.favourites) } label: {
                                        VStack(alignment: .leading, spacing: 8) { Cover(track: track).frame(width: 152, height: 152); Text(track.title).font(.headline).lineLimit(2); Text(track.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }.frame(width: 152, alignment: .leading)
                                    }.buttonStyle(.plain)
                                }
                            }
                        }.scrollIndicators(.hidden)
                    }
                }
                PlaylistShelf(store: store, player: player)
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text("On this device").font(.title2.bold()); Spacer(); Button("Import", systemImage: "plus") { importing = true } }
                    if store.state.local.isEmpty { Text("Import MP3, AAC, WAV, or other supported audio from Files.").foregroundStyle(.secondary) }
                    ForEach(store.state.local, id: \.key) { track in TrackRow(track: track, store: store, player: player, queue: store.state.local) }
                }
            }.padding(20)
        }.navigationTitle("Shelf").toolbar { Button("New playlist", systemImage: "plus") { creating = true } }
            .sheet(isPresented: $creating) { PlaylistEditor { name, description in store.createPlaylist(name: name, description: description) } }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.audio], allowsMultipleSelection: true) { result in if case .success(let urls) = result { Task { await store.importAudio(urls) } } }
    }
}
struct PlaylistShelf: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Playlists").font(.title2.bold())
            if store.state.playlists.isEmpty { Text("Your rotations, all in one place. Create a playlist with the + button on Shelf.").foregroundStyle(.secondary) }
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 16) {
                    ForEach(store.state.playlists) { playlist in
                        NavigationLink { PlaylistView(id: playlist.id, store: store, player: player) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Cover(track: playlist.tracks.first).frame(width: 168, height: 168)
                                Text(playlist.name).font(.headline).lineLimit(2)
                                Text(playlist.description.isEmpty ? "\(playlist.tracks.count) songs" : playlist.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                            }.frame(width: 168, alignment: .leading)
                        }.buttonStyle(.plain)
                    }
                }
            }.scrollIndicators(.hidden)
        }
    }
}
struct TrackList: View {
    var title: String
    var tracks: [Track]
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var body: some View { List { ForEach(tracks, id: \.key) { TrackRow(track: $0, store: store, player: player, queue: tracks) } }.listStyle(.plain).navigationTitle(title) }
}
struct PlaylistView: View {
    var id: String
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var deleting = false
    private var playlist: Playlist? { store.state.playlists.first { $0.id == id } }
    var body: some View {
        Group {
            if let playlist {
                List {
                    Section {
                        HStack(alignment: .center, spacing: 20) {
                            Cover(track: playlist.tracks.first).frame(width: 112, height: 112)
                            VStack(alignment: .leading, spacing: 8) { Text(playlist.description).foregroundStyle(.secondary); Text("\(playlist.tracks.count) songs").font(.subheadline); Button("Play", systemImage: "play.fill") { if let first = playlist.tracks.first { player.play(first, in: playlist.tracks) } }.buttonStyle(.borderedProminent).disabled(playlist.tracks.isEmpty) }
                        }.padding(.vertical, 12)
                    }
                    ForEach(playlist.tracks, id: \.key) { track in
                        TrackRow(track: track, store: store, player: player, queue: playlist.tracks)
                            .swipeActions { Button("Remove", role: .destructive) { store.remove(track, playlistID: id) } }
                    }
                    if playlist.tracks.isEmpty { Text("Add songs using the song’s more menu.").foregroundStyle(.secondary) }
                }.listStyle(.plain).navigationTitle(playlist.name).navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        Menu { Button("Edit playlist", systemImage: "pencil") { editing = true }; Button("Delete playlist", systemImage: "trash", role: .destructive) { deleting = true } } label: { Image(systemName: "ellipsis") }
                    }
                    .sheet(isPresented: $editing) {
                        PlaylistEditor(name: playlist.name, description: playlist.description) { name, description in
                            if let index = store.state.playlists.firstIndex(where: { $0.id == id }) { store.state.playlists[index].name = name; store.state.playlists[index].description = description; store.save() }
                        }
                    }
                    .confirmationDialog("Delete \(playlist.name)?", isPresented: $deleting, titleVisibility: .visible) {
                        Button("Delete playlist", role: .destructive) { store.state.playlists.removeAll { $0.id == id }; store.save(); dismiss() }
                    }
            } else { ContentUnavailableView("Playlist removed", systemImage: "square.stack") }
        }
    }
}
struct PlaylistEditor: View {
    @State var name = ""
    @State var description = ""
    var save: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form { TextField("Name", text: $name).onChange(of: name) { _, value in name = String(value.prefix(80)) }; TextField("Description", text: $description, axis: .vertical).lineLimit(3...5).onChange(of: description) { _, value in description = String(value.prefix(300)) } }
                .navigationTitle("Playlist").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Save") { save(name.trimmingCharacters(in: .whitespacesAndNewlines), description); dismiss() }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) } }
        }
    }
}
struct PlayerDock: View {
    @ObservedObject var player: Player
    @ObservedObject var spotify: Spotify
    var expand: () -> Void
    var body: some View {
        if player.current != nil {
            MiniPlayer(player: player, spotify: spotify, expand: expand)
                .padding(.horizontal, 12).padding(.vertical, 8)
        }
    }
}
struct MiniPlayer: View {
    @ObservedObject var player: Player
    @ObservedObject var spotify: Spotify
    var expand: () -> Void
    var body: some View {
        HStack(spacing: 8) {
            Button(action: expand) {
                HStack(spacing: 12) {
                    Cover(track: player.current, image: player.current?.platform == "spotify" ? spotify.artwork : nil).frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 2) { Text(player.current?.title ?? "").font(.subheadline.weight(.semibold)).lineLimit(1); Text(player.current?.artist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1) }.frame(maxWidth: .infinity, alignment: .leading)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Open now playing")
            Button { player.toggle() } label: {
                if player.loading { ProgressView().frame(width: 44, height: 44) }
                else { Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title3).frame(width: 44, height: 44) }
            }.accessibilityLabel(player.playing ? "Pause" : "Play").accessibilityIdentifier("mini-play")
            Button { player.next() } label: { Image(systemName: "forward.end.fill").frame(width: 44, height: 44) }.accessibilityLabel("Next song")
            Menu { ForEach(Source.allCases) { source in Button(source.label) { player.changeSource(source) } } } label: { Image(systemName: "chevron.down").frame(width: 44, height: 44) }
                .accessibilityLabel("Audio source, \(player.source.label)").disabled(player.current?.platform == "local")
        }.padding(10).modifier(PlayerMaterial())
    }
}
struct PlayerMaterial: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        } else {
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }
}
struct NowPlaying: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @Environment(\.dismiss) private var dismiss
    @State private var seeking = false
    @State private var seekPosition = 0.0
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    if geometry.size.width > 650 {
                        HStack(alignment: .center, spacing: 40) { cover.frame(width: min(geometry.size.width * 0.42, 420)); controls.frame(maxWidth: 440) }.padding(32).frame(maxWidth: .infinity)
                    } else {
                        VStack(spacing: 24) { cover.frame(maxWidth: min(geometry.size.width - 48, 360)); controls }.padding(24).frame(maxWidth: .infinity)
                    }
                }
            }.navigationTitle("Now playing").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }; ToolbarItem(placement: .topBarLeading) { NavigationLink { TrackList(title: "Up next", tracks: player.queue, store: store, player: player) } label: { Image(systemName: "list.bullet") }.accessibilityLabel("Up next") } }
        }
    }
    private var cover: some View { SpotifyCover(track: player.current, spotify: store.spotify) }
    private var controls: some View {
        VStack(spacing: 22) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) { Text(player.current?.title ?? "Choose a song").font(.title2.bold()).fixedSize(horizontal: false, vertical: true); Text(player.current?.artist ?? "").font(.body).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading)
                Button { if let track = player.current { store.favourite(track) } } label: { Image(systemName: store.state.favourites.contains(where: { $0.key == player.current?.key }) ? "heart.fill" : "heart").font(.title2).frame(width: 44, height: 44) }.accessibilityLabel("Favourite")
            }
            VStack(spacing: 4) {
                Slider(value: Binding(get: { seeking ? seekPosition : min(player.position, max(player.duration, 1)) }, set: { seekPosition = $0 }), in: 0...max(player.duration, 1)) { editing in seeking = editing; if !editing { player.seek(seekPosition) } }.accessibilityLabel("Playback position")
                HStack { Text(time(player.position)); Spacer(); Text(time(player.duration)) }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                if player.current?.platform != "spotify" { Button { player.shuffle.toggle() } label: { Image(systemName: "shuffle").foregroundStyle(player.shuffle ? Color.accentColor : Color.secondary).frame(width: 44, height: 44) }.accessibilityLabel("Shuffle") }
                Spacer(minLength: 0)
                Button { player.previous() } label: { Image(systemName: "backward.end.fill").font(.title).frame(width: 44, height: 44) }.accessibilityLabel("Previous song")
                Button { player.toggle() } label: { Group { if player.loading { ProgressView().tint(.white) } else { Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.largeTitle) } }.frame(width: 68, height: 68).background(Color.accentColor, in: Circle()).foregroundStyle(.white) }.accessibilityLabel(player.playing ? "Pause" : "Play")
                Button { player.next() } label: { Image(systemName: "forward.end.fill").font(.title).frame(width: 44, height: 44) }.accessibilityLabel("Next song")
                Spacer(minLength: 0)
                if player.current?.platform != "spotify" { Button { player.repeatOne.toggle() } label: { Image(systemName: player.repeatOne ? "repeat.1" : "repeat").foregroundStyle(player.repeatOne ? Color.accentColor : Color.secondary).frame(width: 44, height: 44) }.accessibilityLabel("Repeat song") }
            }.buttonStyle(.plain)
            HStack { Text(player.current?.sourceName ?? "").font(.subheadline).foregroundStyle(.secondary); Spacer(); Menu { ForEach(Source.allCases) { source in Button(source.label) { player.changeSource(source) } } } label: { Label(player.source.label, systemImage: "chevron.down").font(.subheadline).frame(minHeight: 44) }.disabled(player.current?.platform == "local") }
            HStack(spacing: 16) { Image(systemName: "speaker.fill").foregroundStyle(.secondary); SystemVolume().frame(height: 32); AirPlay().frame(width: 44, height: 44) }
        }
    }
    private func time(_ seconds: Double) -> String { let value = max(0, Int(seconds.isFinite ? seconds : 0)); return "\(value / 60):" + String(format: "%02d", value % 60) }
}
struct SpotifyCover: View {
    var track: Track?
    @ObservedObject var spotify: Spotify
    var body: some View { Cover(track: track, image: track?.platform == "spotify" ? spotify.artwork : nil) }
}
struct SystemVolume: UIViewRepresentable {
    func makeUIView(context: Context) -> MPVolumeView { let view = MPVolumeView(); view.showsRouteButton = false; return view }
    func updateUIView(_ view: MPVolumeView, context: Context) {}
}
struct AirPlay: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView { let view = AVRoutePickerView(); view.activeTintColor = .systemBlue; return view }
    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
