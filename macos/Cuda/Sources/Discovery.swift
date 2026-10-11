import SwiftUI

struct WeeklyShelf: View {
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @State private var selected: SpotifyAlbum?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text("This week’s discoveries").font(.title2.bold()); Spacer(); Button("Find albums", systemImage: "arrow.clockwise") { Task { await store.weeklyPicks() } }.buttonStyle(.glass).disabled(store.refreshing) }
            if let albums = store.spotify.weekly?.items, !albums.isEmpty {
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 20) {
                        ForEach(albums) { album in
                            Button { selected = album } label: { VStack(alignment: .leading, spacing: 8) { Cover(track: album.cover).frame(width: 152, height: 152); Text(album.name).font(.headline).lineLimit(2); Text(album.reason ?? album.cover.artist).font(.callout).foregroundStyle(.secondary).lineLimit(3) }.frame(width: 152, alignment: .leading) }.buttonStyle(.plain)
                        }
                    }
                }.scrollIndicators(.hidden)
            } else { Text("Explore albums shaped by your Spotify playlists and Last.fm listening.").foregroundStyle(.secondary) }
        }.sheet(item: $selected) { album in AlbumView(album: album, store: store, player: player) }
    }
}
struct AlbumView: View {
    var album: SpotifyAlbum
    @ObservedObject var store: Store
    @ObservedObject var player: Player
    @Environment(\.dismiss) private var dismiss
    @State private var tracks: [Track] = []
    @State private var loading = true
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 20) { Cover(track: album.cover).frame(width: 120, height: 120); VStack(alignment: .leading, spacing: 10) { Text(album.name).font(.title2.bold()).lineLimit(3); Text(album.cover.artist).foregroundStyle(.secondary); HStack { Button("Play", systemImage: "play.fill") { if let first = tracks.first { player.play(first, in: tracks) } }.buttonStyle(.glassProminent).disabled(tracks.isEmpty); Button("Add to Shelf", systemImage: "plus") { Task { await store.addAlbum(album) } }.buttonStyle(.glass) } } }
            if loading { ProgressView().frame(maxWidth: .infinity) }
            if let error { Text(error).foregroundStyle(.secondary) }
            List { ForEach(tracks, id: \.key) { TrackRow(track: $0, queue: tracks, store: store, player: player) } }.listStyle(.inset)
            HStack { Button("Hide recommendation") { Task { do { store.spotify = try await store.runtime.spotify("dismiss", [album.id]); dismiss() } catch { self.error = error.localizedDescription } } }; Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
        }.padding(24).frame(width: 560, height: 600)
            .task { do { tracks = try await store.runtime.spotify("albumTracks", [album.id]) } catch { self.error = error.localizedDescription }; loading = false }
    }
}
