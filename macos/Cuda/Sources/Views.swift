import SwiftUI
import AppKit

// The window and sidebar geometry belong to macOS. Only floating controls receive custom glass.
enum Page: String, CaseIterable, Identifiable {
    case home = "Home", search = "Search", shelf = "Shelf", history = "Last played", queue = "Up next", audio = "Audio", settings = "Settings"
    var id: String { rawValue }
    var symbol: String { switch self { case .home: return "house"; case .search: return "magnifyingglass"; case .shelf: return "square.stack"; case .history: return "clock"; case .queue: return "list.bullet"; case .audio: return "slider.horizontal.3"; case .settings: return "gearshape" } }
}
struct RootView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @State private var page: Page = .home
    @State private var query = ""
    @State private var expanded = false
    @State private var playlist: String?
    @FocusState private var searchFocused: Bool
    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                Button("Cuda") { page = .home; playlist = nil; query = "" }
                    .font(.title2.weight(.semibold)).buttonStyle(.plain).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.vertical, 18)
                List(selection: $page) {
                    ForEach([Page.home, .search, .shelf]) { item in Label(item.rawValue, systemImage: item.symbol).tag(item) }
                    Section {
                        ForEach([Page.history, .queue]) { item in Label(item.rawValue, systemImage: item.symbol).tag(item) }
                    }
                    Section {
                        ForEach([Page.audio, .settings]) { item in Label(item.rawValue, systemImage: item.symbol).tag(item) }
                    }
                }.listStyle(.sidebar)
            }.navigationSplitViewColumnWidth(min: 170, ideal: 205, max: 260)
        } detail: {
            VStack(spacing: 0) {
                if !store.ready {
                    ContentUnavailableView { Label("Welcome to Cuda", systemImage: "music.note") } description: { Text("Starting your music services…") } actions: { ProgressView() }
                } else if let id = playlist {
                    PlaylistDetail(id: id, store: store, player: player, back: { playlist = nil })
                } else {
                    content
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if player.current != nil { CompactPlayer(player: player, expand: { expanded = true }).padding(14) }
            }
            .background { WindowBackground() }
        }
        .scrollContentBackground(.hidden)
        .containerBackground(for: .window) { WindowBackground() }
        .navigationTitle("Cuda")
        .searchable(text: $query, placement: .toolbar, prompt: "Search music, artists, or albums")
        .searchFocused($searchFocused)
        .toolbar {
            ToolbarItem { Button { store.importAudio() } label: { Label("Import music", systemImage: "plus") }.disabled(!store.ready) }
            ToolbarItem { MiniWindowButton() }
        }
        .onChange(of: page) { _, value in playlist = nil; if value == .search { searchFocused = true } }
        .onChange(of: query) { _, value in if !value.isEmpty { page = .search; playlist = nil } }
        .task(id: query + (store.ready ? "ready" : "starting")) { if store.ready { await store.search(query) } }
        .onReceive(NotificationCenter.default.publisher(for: .cudaSearch)) { _ in page = .search; searchFocused = true }
        .onReceive(NotificationCenter.default.publisher(for: .cudaHome)) { _ in page = .home; playlist = nil }
        .onReceive(NotificationCenter.default.publisher(for: .cudaPlayer)) { _ in expanded = true }
        .sheet(isPresented: $expanded) { NowPlaying(store: store, player: player) }
        .alert("Cuda", isPresented: Binding(get: { store.message != nil || player.error != nil }, set: { if !$0 { store.message = nil; player.error = nil } })) { Button("OK") { store.message = nil; player.error = nil } } message: { Text(store.message ?? player.error ?? "") }
        .overlay(alignment: .top) {
            if let notice = store.notice { HStack { Text(notice).font(.callout); Button("Dismiss", systemImage: "xmark") { store.notice = nil }.labelStyle(.iconOnly) }.padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)).padding(16) }
        }
        .frame(minWidth: 620, minHeight: 480)
        .task { if !store.ready { await store.start() }; captureIfRequested() }
    }
    @ViewBuilder private var content: some View {
        switch page {
        case .home: HomeView(store: store, player: player, history: { page = .history }, playlist: { playlist = $0 })
        case .search: SearchView(store: store, player: player, query: query)
        case .shelf: ShelfView(store: store, player: player, playlist: { playlist = $0 })
        case .history: SongList(title: "Last played", subtitle: "Your recent listening", tracks: store.state.history, store: store, player: player)
        case .queue: SongList(title: "Up next", subtitle: "\(player.queue.count) songs in your queue", tracks: player.queue, store: store, player: player)
        case .audio: AudioView(player: player)
        case .settings: SettingsView(store: store)
        }
    }
    private func captureIfRequested() {
        #if DEBUG
        if ProcessInfo.processInfo.environment["CUDA_NATIVE_CAPTURE"] == "1" {
            if ProcessInfo.processInfo.environment["CUDA_NATIVE_PAGE"] == "shelf" { page = .shelf }
            if ProcessInfo.processInfo.environment["CUDA_NATIVE_PAGE"] == "search" { page = .search }
            if ProcessInfo.processInfo.environment["CUDA_NATIVE_PAGE"] == "settings" { page = .settings }
            if let track = store.state.local.first { player.play(track, in: store.state.local) }
            if ProcessInfo.processInfo.environment["CUDA_NATIVE_PAGE"] == "player" { expanded = true }
            Task { try? await Task.sleep(for: .seconds(3)); NativeCapture.save() }
        }
        #endif
    }
}
struct MiniWindowButton: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View { Button { openWindow(id: "mini") } label: { Label("Open mini player", systemImage: "pip") } }
}
struct WindowBackground: View {
    @AppStorage("native-transparency") private var transparent = true
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var body: some View {
        ZStack {
            if !transparent || reduceTransparency { Color(nsColor: .windowBackgroundColor) }
            WindowMaterial(enabled: transparent && !reduceTransparency)
        }.ignoresSafeArea()
    }
}
struct WindowMaterial: NSViewRepresentable {
    var enabled: Bool
    func makeNSView(context: Context) -> NativeWindowMaterial {
        let view = NativeWindowMaterial()
        view.blendingMode = .behindWindow
        view.material = .underWindowBackground
        view.state = .active
        view.enabled = enabled
        return view
    }
    func updateNSView(_ view: NativeWindowMaterial, context: Context) { view.enabled = enabled }
}
final class NativeWindowMaterial: NSVisualEffectView {
    var enabled = true { didSet { configureWindow() } }
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); configureWindow() }
    private func configureWindow() {
        isHidden = !enabled
        window?.isOpaque = !enabled
        window?.backgroundColor = enabled ? .clear : .windowBackgroundColor
    }
}
struct Cover: View {
    var track: Track?
    var body: some View {
        // The layout is owned by this square, never by the image's intrinsic size.
        GeometryReader { geometry in
            ZStack {
                Rectangle().fill(.quaternary)
                artwork
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
    @ViewBuilder private var artwork: some View {
        if let raw = track?.thumbnail, raw.hasPrefix("demo-"), let url = Bundle.main.url(forResource: raw, withExtension: "png"), let image = NSImage(contentsOf: url) {
            Image(nsImage: image).resizable().scaledToFill()
        } else if let raw = track?.thumbnail, let url = URL(string: raw), ["https", "http"].contains(url.scheme ?? ""), url.scheme == "https" || url.host == "127.0.0.1" {
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { fallback }
        } else { fallback }
    }
    private var fallback: some View { Image(systemName: "music.note").font(.system(size: 26, weight: .medium)).foregroundStyle(.secondary) }
}
struct TrackRow: View {
    var track: Track
    var queue: [Track]
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var body: some View {
        HStack(spacing: 12) {
            Button { player.play(track, in: queue) } label: {
                HStack(spacing: 12) {
                    Cover(track: track).frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 4) { Text(track.title).font(.body.weight(.medium)).lineLimit(1); Text(track.artist).font(.callout).foregroundStyle(.secondary).lineLimit(1) }.frame(maxWidth: .infinity, alignment: .leading)
                    if player.current?.key == track.key { Image(systemName: player.playing ? "waveform" : "pause.fill").foregroundStyle(.tint) }
                    Text(track.sourceName).font(.caption).foregroundStyle(.secondary).frame(width: 90, alignment: .trailing)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Play \(track.title)")
            Menu { TrackActions(track: track, store: store, player: player) } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 24).accessibilityLabel("More options for \(track.title)")
        }.padding(.vertical, 5).contextMenu { TrackActions(track: track, store: store, player: player) }
    }
}
struct TrackActions: View {
    var track: Track
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var body: some View {
        Button(store.state.favourites.contains(where: { $0.sameRecording(track) }) ? "Remove favourite" : "Favourite", systemImage: "heart") { store.favourite(track) }
        Menu("Add to playlist", systemImage: "text.badge.plus") { ForEach(store.state.playlists.filter { $0.spotifyID == nil }) { playlist in Button(playlist.name) { store.add(track, to: playlist.id) } } }
        Button("Play next", systemImage: "text.line.first.and.arrowtriangle.forward") { let index = player.queue.firstIndex { $0.sameRecording(player.current) }.map { $0 + 1 } ?? 0; player.queue.insert(track, at: min(index, player.queue.count)) }
        if track.platform != "local", track.platform != "spotify" { Button("Download audio", systemImage: "arrow.down.circle") { Task { await store.download(track) } } }
        if let url = URL(string: track.url), url.scheme == "https" { Button("Open source", systemImage: "arrow.up.right") { NSWorkspace.shared.open(url) } }
    }
}
struct Header: View {
    var title: String
    var subtitle: String? = nil
    var body: some View { VStack(alignment: .leading, spacing: 8) { Text(title).font(.largeTitle.bold()); if let subtitle { Text(subtitle).font(.body).foregroundStyle(.secondary).lineLimit(3) } }.frame(maxWidth: .infinity, alignment: .leading) }
}
struct HomeView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var history: () -> Void
    var playlist: (String) -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                Header(title: "Home")
                if store.state.history.isEmpty && store.recommendations.isEmpty {
                    ContentUnavailableView { Label("Your music starts here", systemImage: "music.note") } description: { Text("Import songs, search your next favourite, or connect Spotify in Settings.") } actions: { Button("Import music", systemImage: "plus") { store.importAudio() }.buttonStyle(.borderedProminent) }
                }
                if !store.state.history.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Text("Last played").font(.title2.bold()); Spacer(); Button("View all", action: history).buttonStyle(.plain).foregroundStyle(.tint) }
                        ForEach(Array(Track.unique(store.state.history).prefix(4)), id: \.key) { TrackRow(track: $0, queue: store.state.history, store: store, player: player) }
                    }
                }
                VStack(alignment: .leading, spacing: 16) {
                    HStack { Text("For you").font(.title2.bold()); Spacer(); Menu(store.mood == "all" ? "All music" : store.mood.capitalized) { ForEach(["all", "relax", "workout", "electronic", "rock", "jazz"], id: \.self) { genre in Button(genre == "all" ? "All music" : genre.capitalized) { store.mood = genre; Task { await store.refresh() } } } }.fixedSize(); if store.refreshing { ProgressView().controlSize(.small) } else { Button { Task { await store.refresh() } } label: { Label("Refresh recommendations", systemImage: "arrow.clockwise") }.labelStyle(.iconOnly).buttonStyle(.glass) } }
                    if store.recommendations.isEmpty { Text("Favourites and playlists help Cuda find music for you.").foregroundStyle(.secondary) }
                    else { SongShelf(tracks: store.recommendations, store: store, player: player) }
                }
                if store.spotify.connected && store.spotify.playbackConnected { Menu("Spotify radio", systemImage: "dot.radiowaves.left.and.right") { ForEach(["pop", "rock", "electronic", "jazz", "classical", "hip hop"], id: \.self) { genre in Button(genre.capitalized) { Task { await store.genreRadio(genre) } } } }.fixedSize() }
                if store.spotify.connected { WeeklyShelf(store: store, player: player) }
                if !store.state.playlists.isEmpty { PlaylistShelf(store: store, open: playlist) }
            }.padding(28).frame(maxWidth: 1300, alignment: .leading).frame(maxWidth: .infinity)
        }
    }
}
struct SongShelf: View {
    var tracks: [Track]
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 20) {
                ForEach(tracks, id: \.key) { track in
                    Button { player.play(track, in: tracks) } label: {
                        VStack(alignment: .leading, spacing: 8) { Cover(track: track).frame(width: 152, height: 152); Text(track.title).font(.headline).lineLimit(2); Text(track.artist).font(.callout).foregroundStyle(.secondary).lineLimit(1) }.frame(width: 152, alignment: .leading)
                    }.buttonStyle(.plain).contextMenu { TrackActions(track: track, store: store, player: player) }
                }
            }
        }.scrollIndicators(.hidden)
    }
}
struct PlaylistShelf: View {
    @ObservedObject var store: Store
    var open: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Playlists").font(.title2.bold())
            if store.state.playlists.isEmpty { Text("Create a playlist to keep your music together.").foregroundStyle(.secondary) }
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 20) {
                    ForEach(store.state.playlists) { playlist in
                        Button { open(playlist.id) } label: {
                            VStack(alignment: .leading, spacing: 8) { Cover(track: playlist.tracks.first).frame(width: 168, height: 168); Text(playlist.name).font(.headline).lineLimit(2); Text(playlist.description.isEmpty ? "\(playlist.tracks.count) songs" : playlist.description).font(.callout).foregroundStyle(.secondary).lineLimit(2) }.frame(width: 168, alignment: .leading)
                        }.buttonStyle(.plain)
                    }
                }
            }.scrollIndicators(.hidden)
        }
    }
}
struct ShelfView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var playlist: (String) -> Void
    @State private var creating = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                HStack { Header(title: "Shelf", subtitle: "The music you keep close"); Button("New playlist", systemImage: "plus") { creating = true }.buttonStyle(.glass) }
                VStack(alignment: .leading, spacing: 16) { Text("Favourites").font(.title2.bold()); if store.state.favourites.isEmpty { Text("Favourite a song to keep it here.").foregroundStyle(.secondary) } else { SongShelf(tracks: store.state.favourites, store: store, player: player) } }
                PlaylistShelf(store: store, open: playlist)
                VStack(alignment: .leading, spacing: 12) { HStack { Text("Imported music").font(.title2.bold()); Spacer(); Button("Import", systemImage: "plus") { store.importAudio() }.buttonStyle(.plain).foregroundStyle(.tint) }; if store.state.local.isEmpty { Text("Add audio files from your Mac.").foregroundStyle(.secondary) }; ForEach(store.state.local, id: \.key) { TrackRow(track: $0, queue: store.state.local, store: store, player: player) } }
            }.padding(28)
        }.sheet(isPresented: $creating) { PlaylistEditor { name, description in store.createPlaylist(name: name, description: description) } }
    }
}
struct SearchView: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var query: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Header(title: "Search", subtitle: query.isEmpty ? "Songs, artists, and new discoveries" : "Results for “\(query)”"); if store.searching { ProgressView().controlSize(.small) } }.padding(.horizontal, 28).padding(.top, 28)
            if store.results.isEmpty { ContentUnavailableView(query.isEmpty ? "Find your next favourite" : store.searching ? "Searching your sources…" : "No songs found", systemImage: "magnifyingglass", description: Text(query.isEmpty ? "Use the search field in the toolbar. Results arrive as each source responds." : "Try another artist or song name.")).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else { List { ForEach(store.results, id: \.key) { TrackRow(track: $0, queue: store.results, store: store, player: player) } }.listStyle(.inset) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
struct SongList: View {
    var title: String
    var subtitle: String
    var tracks: [Track]
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var body: some View { VStack(alignment: .leading) { Header(title: title, subtitle: subtitle).padding(28); if tracks.isEmpty { ContentUnavailableView("No songs yet", systemImage: "music.note", description: Text("Play music to fill this view.")).frame(maxWidth: .infinity, maxHeight: .infinity) } else { List { ForEach(Track.unique(tracks), id: \.key) { TrackRow(track: $0, queue: tracks, store: store, player: player) } }.listStyle(.inset) } }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading) }
}
struct PlaylistDetail: View {
    var id: String
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    var back: () -> Void
    @State private var editing = false
    @State private var deleting = false
    private var playlist: Playlist? { store.state.playlists.first { $0.id == id } }
    var body: some View {
        if let playlist {
            VStack(alignment: .leading, spacing: 16) {
                Button("Back to Shelf", systemImage: "chevron.left", action: back).buttonStyle(.plain).foregroundStyle(.tint).padding(.horizontal, 28).padding(.top, 20)
                HStack(alignment: .center, spacing: 24) {
                    Cover(track: playlist.tracks.first).frame(width: 160, height: 160)
                    VStack(alignment: .leading, spacing: 14) {
                        Header(title: playlist.name, subtitle: playlist.description)
                        Text("\(playlist.tracks.count) songs").foregroundStyle(.secondary)
                        HStack { Button("Play", systemImage: "play.fill") { if let first = playlist.tracks.first { player.play(first, in: playlist.tracks) } }.buttonStyle(.glassProminent).disabled(playlist.tracks.isEmpty); Menu { Button("Edit playlist", systemImage: "pencil") { editing = true }; Button("Delete playlist", systemImage: "trash", role: .destructive) { deleting = true } } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 30) }
                    }
                }.padding(.horizontal, 28)
                List { ForEach(playlist.tracks, id: \.key) { track in TrackRow(track: track, queue: playlist.tracks, store: store, player: player).contextMenu { Button("Remove from playlist", systemImage: "minus.circle") { if let index = store.state.playlists.firstIndex(where: { $0.id == id }) { store.state.playlists[index].tracks.removeAll { $0.sameRecording(track) }; store.save() } } } } }.listStyle(.inset)
            }
            .sheet(isPresented: $editing) { PlaylistEditor(name: playlist.name, description: playlist.description) { name, description in if let index = store.state.playlists.firstIndex(where: { $0.id == id }) { store.state.playlists[index].name = name; store.state.playlists[index].description = description; store.save() } } }
            .confirmationDialog("Delete “\(playlist.name)”?", isPresented: $deleting) { Button("Delete playlist", role: .destructive) { store.state.playlists.removeAll { $0.id == id }; store.save(); back() } }
        }
    }
}
struct PlaylistEditor: View {
    @State var name = ""
    @State var description = ""
    var save: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Playlist").font(.title2.bold())
            Form { TextField("Name", text: $name); TextField("Description", text: $description, axis: .vertical).lineLimit(3...5) }
            HStack { Spacer(); Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction); Button("Save") { save(String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)), String(description.prefix(300))); dismiss() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
        }.padding(24).frame(width: 420)
    }
}
struct CompactPlayer: View {
    @ObservedObject var player: Player
    var expand: () -> Void
    @AppStorage("native-glass-tint") private var tint = 0.0
    var body: some View {
        ViewThatFits(in: .horizontal) {
            row(wide: true)
            row(wide: false)
            VStack(spacing: 12) {
                Button(action: expand) { HStack(spacing: 10) { Cover(track: player.current).frame(width: 36, height: 36); VStack(alignment: .leading) { Text(player.current?.title ?? "").font(.headline).lineLimit(1); Text(player.current?.artist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1) }.frame(maxWidth: .infinity, alignment: .leading) } }.buttonStyle(.plain).accessibilityLabel("Open now playing")
                HStack { Spacer(); Transport(player: player, large: false); Spacer(); SourceMenu(player: player, iconOnly: true) }
            }
        }.padding(12).glassEffect(.regular.tint(Color(nsColor: .windowBackgroundColor).opacity(tint / 100)), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
    private func row(wide: Bool) -> some View {
        HStack(spacing: 16) {
            Button(action: expand) {
                HStack(spacing: 12) { Cover(track: player.current).frame(width: 48, height: 48); VStack(alignment: .leading, spacing: 3) { Text(player.current?.title ?? "Choose a song").font(.headline).lineLimit(1); Text(player.current?.artist ?? "").font(.callout).foregroundStyle(.secondary).lineLimit(1); Text(player.current?.sourceName ?? "").font(.caption).foregroundStyle(.secondary) }.frame(minWidth: wide ? 140 : 80, maxWidth: .infinity, alignment: .leading) }
            }.buttonStyle(.plain).accessibilityLabel("Open now playing")
            Transport(player: player, large: false)
            if wide { Image(systemName: "speaker.wave.2").foregroundStyle(.secondary); Slider(value: $player.volume, in: 0...1).frame(width: 80).accessibilityLabel("Volume") }
            SourceMenu(player: player, iconOnly: true)
        }
    }
}
struct SourceMenu: View {
    @ObservedObject var player: Player
    var iconOnly = false
    var body: some View { if player.current?.platform != "local" { Menu { ForEach(Source.allCases) { source in Button { player.changeSource(source) } label: { if source == player.source { Label(source.label, systemImage: "checkmark") } else { Text(source.label) } } } } label: { if iconOnly { Image(systemName: "chevron.down") } else { Text(player.source.label) } }.menuStyle(.borderlessButton).menuIndicator(iconOnly ? .hidden : .visible).fixedSize().accessibilityLabel("Audio source, \(player.source.label)") } }
}
struct Transport: View {
    @ObservedObject var player: Player
    var large: Bool
    var body: some View {
        HStack(spacing: large ? 24 : 12) {
            Button { player.previous() } label: { Image(systemName: "backward.end.fill") }.buttonStyle(.plain).accessibilityLabel("Previous song")
            Button { player.toggle() } label: { Group { if player.loading { ProgressView().controlSize(.small) } else { Image(systemName: player.playing ? "pause.fill" : "play.fill") } }.frame(width: large ? 42 : 24, height: large ? 42 : 24) }.buttonStyle(.glassProminent).buttonBorderShape(.circle).accessibilityLabel(player.playing ? "Pause" : "Play").accessibilityIdentifier("player-play")
            Button { player.next() } label: { Image(systemName: "forward.end.fill") }.buttonStyle(.plain).accessibilityLabel("Next song")
        }.font(large ? .title2 : .title3).fixedSize()
    }
}
struct NowPlaying: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @Environment(\.dismiss) private var dismiss
    @State private var seek = 0.0
    @State private var dragging = false
    @State private var audio = false
    @State private var lyrics = false
    var body: some View {
        VStack(spacing: 20) {
            HStack { Text("Now playing").font(.headline); Spacer(); Button(lyrics ? "Player" : "Lyrics", systemImage: lyrics ? "music.note" : "quote.bubble") { lyrics.toggle() }.buttonStyle(.glass); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
            if lyrics {
                VStack(alignment: .leading, spacing: 4) { Text(player.current?.title ?? "Choose a song").font(.title2.bold()); Text(player.current?.artist ?? "").foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading)
                LyricsPanel(player: player).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else { ScrollView {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 32) { Cover(track: player.current).frame(width: 300, height: 300); controls.frame(width: 320) }
                    VStack(spacing: 24) { Cover(track: player.current).frame(width: 220, height: 220); controls }
                }
            }.scrollIndicators(.hidden) }
        }.padding(28).frame(width: width, height: lyrics || width < 680 ? min(700, (NSScreen.main?.visibleFrame.height ?? 800) - 80) : 440)
        .sheet(isPresented: $audio) { VStack { AudioView(player: player); Button("Done") { audio = false }.padding() }.frame(width: min(550, width), height: 620) }
    }
    private var width: CGFloat { min(720, max(360, (NSApp.mainWindow?.frame.width ?? 800) - 48)) }
    private var controls: some View {
VStack(alignment: .leading, spacing: 24) {
                    HStack(alignment: .top) { VStack(alignment: .leading, spacing: 6) { Text(player.current?.title ?? "Choose a song").font(.title.bold()).lineLimit(3); Text(player.current?.artist ?? "").foregroundStyle(.secondary) }; Spacer(); Button { if let track = player.current { store.favourite(track) } } label: { Image(systemName: store.state.favourites.contains(where: { $0.sameRecording(player.current) }) ? "heart.fill" : "heart") }.buttonStyle(.glass).accessibilityLabel("Favourite") }
                    VStack(spacing: 6) { Slider(value: Binding(get: { dragging ? seek : min(player.position, max(1, player.duration)) }, set: { seek = $0 }), in: 0...max(1, player.duration)) { editing in dragging = editing; if !editing { player.seek(seek) } }.accessibilityLabel("Playback position"); HStack { Text(time(player.position)); Spacer(); Text(time(player.duration)) }.font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                    HStack { Button { player.shuffle.toggle() } label: { Image(systemName: "shuffle").foregroundStyle(player.shuffle ? Color.accentColor : .secondary) }.buttonStyle(.plain).accessibilityLabel("Shuffle"); Spacer(); Transport(player: player, large: true); Spacer(); Button { player.repeatOne.toggle() } label: { Image(systemName: player.repeatOne ? "repeat.1" : "repeat").foregroundStyle(player.repeatOne ? Color.accentColor : .secondary) }.buttonStyle(.plain).accessibilityLabel("Repeat") }
                    HStack { Text(player.current?.sourceName ?? "").font(.callout).foregroundStyle(.secondary); Spacer(); SourceMenu(player: player) }
                    HStack { Button { audio = true } label: { Label("Audio", systemImage: "slider.horizontal.3") }.buttonStyle(.glass); Image(systemName: "speaker.wave.2").foregroundStyle(.secondary); Slider(value: $player.volume, in: 0...1).accessibilityLabel("Volume") }
                }
    }
}
func time(_ value: Double) -> String { let seconds = max(0, Int(value.isFinite ? value : 0)); return String(format: "%d:%02d", seconds / 60, seconds % 60) }
extension Notification.Name { static let cudaSearch = Notification.Name("CudaSearch"); static let cudaHome = Notification.Name("CudaHome"); static let cudaPlayer = Notification.Name("CudaPlayer") }
