import SwiftUI

struct GenreSelector: View {
    var genres: [String]
    var selection: String
    var refreshing: Bool
    var select: (String) -> Void
    var refresh: () -> Void
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { title.fixedSize(); Spacer(minLength: 12); controls.fixedSize() }
            VStack(alignment: .leading, spacing: 8) { title; HStack { controls; Spacer(minLength: 0) } }
        }
    }
    private var title: some View { Text("For you").font(.title2.bold()) }
    private var controls: some View {
        HStack(spacing: 8) {
            Picker("Recommendation genre", selection: Binding(get: { selection }, set: select)) {
                Text("All music").tag("all")
                ForEach(genres, id: \.self) { Text(StreamingPreferences.genreLabel($0)).tag($0) }
            }.labelsHidden().pickerStyle(.menu).disabled(refreshing).frame(minHeight: 44)
            if refreshing { ProgressView().frame(width: 44, height: 44).accessibilityLabel("Loading recommendations") }
            else { Button(action: refresh) { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44).contentShape(Rectangle()) }.buttonStyle(.borderless).accessibilityLabel("Refresh recommendations") }
        }
    }
}
