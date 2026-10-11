import SwiftUI

struct LyricsResult: Decodable {
    var provider: String
    var label: String
    var text: String
    var message: String?
    var copyright: String?
    var url: String?
    var instrumental: Bool?
    var displayToken: String?
}
struct LyricsProviderStatus: Decodable {
    var hasKeys = false
    var musixmatch = false
    var lyricfind = false
    var genius = false
    var territory = "US"
}
struct LyricsPanel: View {
    @ObservedObject var player: Player
    @State private var provider = "auto"
    @State private var result: LyricsResult?
    @State private var lines: [LyricLine] = []
    @State private var loading = false
    @State private var error: String?
    @State private var refresh = UUID()
    private var requestKey: String { [player.current?.title ?? "", player.current?.artist ?? "", provider, refresh.uuidString].joined(separator: "\u{1f}") }
    private var active: Int? { lines.last(where: { ($0.time ?? .infinity) <= player.position })?.id }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Picker("Lyrics source", selection: $provider) { Text("Auto").tag("auto"); Text("LyricFind").tag("lyricfind"); Text("Musixmatch").tag("musixmatch"); Text("Genius").tag("genius") }.pickerStyle(.menu)
                Spacer()
                Button { refresh = UUID() } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Refresh lyrics")
            }
            if loading { HStack { ProgressView().controlSize(.small); Text("Finding lyrics…").foregroundStyle(.secondary) }.frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let error { ContentUnavailableView("Lyrics unavailable", systemImage: "quote.bubble", description: Text(error)).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let result {
                if result.instrumental == true { ContentUnavailableView("Instrumental", systemImage: "music.note", description: Text("This recording has no sung lyrics.")).frame(maxWidth: .infinity, maxHeight: .infinity) }
                else if !lines.isEmpty {
                    ScrollViewReader { proxy in
                        ScrollView { LazyVStack(alignment: .leading, spacing: 18) {
                            ForEach(lines) { line in
                                Text(line.text.isEmpty ? " " : line.text).font(.title3.weight(line.id == active ? .semibold : .regular))
                                    .foregroundStyle(line.time == nil || line.id == active ? Color.primary : Color.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled).id(line.id)
                                    .onTapGesture { if let seconds = line.time { player.seek(seconds) } }
                            }
                        }.padding(.vertical, 12) }
                        .onChange(of: active) { _, id in if let id { withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) } } }
                    }
                } else { ContentUnavailableView("Lyrics on \(result.label)", systemImage: "quote.bubble", description: Text(result.message ?? "Lyrics are not available for this song.")).frame(maxWidth: .infinity, maxHeight: .infinity) }
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text("Source: \(result.label)").font(.caption).foregroundStyle(.secondary); Spacer(); if let raw = result.url, let url = URL(string: raw), url.scheme == "https" { Link("Open \(result.label)", destination: url) } }
                    if let copyright = result.copyright, !copyright.isEmpty { Text(copyright).font(.caption2).foregroundStyle(.secondary).textSelection(.enabled) }
                }
            }
        }.task(id: requestKey) {
            let key = requestKey; result = nil; lines = []; error = nil; loading = true
            do {
                let track = player.current
                let data = try await player.runtime.call("lyricsGet", ["title": track?.title ?? "", "artist": track?.artist ?? "", "provider": provider])
                try Task.checkCancellation(); guard key == requestKey else { return }
                let value = try JSONDecoder().decode(LyricsResult.self, from: data); result = value; lines = LyricLine.parse(value.text); loading = false
                if let token = value.displayToken, !value.text.isEmpty { _ = try? await player.runtime.call("lyricsViewed", ["token": token]) }
            } catch is CancellationError { }
            catch { if key == requestKey { self.error = error.localizedDescription; loading = false } }
        }
    }
}
struct LyricsSettings: View {
    @ObservedObject var runtime: Runtime
    @State private var status = LyricsProviderStatus()
    @State private var musixmatch = ""
    @State private var lyricfindSearch = ""
    @State private var lyricfindDisplay = ""
    @State private var genius = ""
    @State private var territory = Locale.current.region?.identifier ?? "US"
    @State private var notice = ""
    @State private var saving = false
    var body: some View {
        Section("Lyrics") {
            SecureField(status.musixmatch ? "Musixmatch API key (saved)" : "Musixmatch API key", text: $musixmatch)
            SecureField(status.lyricfind ? "LyricFind Search key (saved)" : "LyricFind Search key", text: $lyricfindSearch)
            SecureField(status.lyricfind ? "LyricFind Display key (saved)" : "LyricFind Display key", text: $lyricfindDisplay)
            SecureField(status.genius ? "Genius access token (saved)" : "Genius access token", text: $genius)
            TextField("Licensed territory (two-letter country)", text: $territory)
            HStack {
                Button("Save lyrics providers") { save(clear: false) }.disabled(saving || !runtime.ready)
                Button("Remove provider keys", role: .destructive) { save(clear: true) }.disabled(saving || !status.hasKeys || !runtime.ready)
                if saving { ProgressView().controlSize(.small) }
            }
            Text("Keys are encrypted using your Mac’s Keychain. Leave a key field empty to keep its saved value. LyricFind needs licensed Search and Display access; Musixmatch needs an API key. Genius offers song lookup and opens full lyrics on its site.").font(.callout).foregroundStyle(.secondary)
            HStack { Link("LyricFind", destination: URL(string: "https://www.lyricfind.com/contact")!); Link("Musixmatch", destination: URL(string: "https://developer.musixmatch.com/")!); Link("Genius", destination: URL(string: "https://genius.com/api-clients")!) }
            if !notice.isEmpty { Text(notice).font(.callout).foregroundStyle(.secondary) }
        }.task(id: runtime.ready) { guard runtime.ready else { return }; if let data = try? await runtime.call("lyricsStatus"), let value = try? JSONDecoder().decode(LyricsProviderStatus.self, from: data) { status = value; if value.hasKeys { territory = value.territory } } }
    }
    private func save(clear: Bool) {
        saving = true
        Task {
            defer { saving = false }
            do {
                let args: [String: Any] = clear ? ["clear": true] : ["musixmatch": musixmatch, "lyricfindSearch": lyricfindSearch, "lyricfindDisplay": lyricfindDisplay, "genius": genius, "territory": territory]
                let data = try await runtime.call("lyricsConfigure", args); status = try JSONDecoder().decode(LyricsProviderStatus.self, from: data)
                musixmatch = ""; lyricfindSearch = ""; lyricfindDisplay = ""; genius = ""; notice = clear ? "Lyrics provider keys removed." : "Lyrics providers saved."
            } catch { notice = error.localizedDescription }
        }
    }
}
