import Foundation
import Combine
import SwiftUI

@MainActor
final class StreamingPreferences: ObservableObject {
    static let shared = StreamingPreferences()
    static let services = ["spotify", "youtube", "ytmusic", "soundcloud", "audius"]
    @Published private(set) var enabled: [String]
    private let defaults: UserDefaults
    var changed: (([String]) -> Void)?
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        enabled = (defaults.stringArray(forKey: "streaming-services") ?? Array(Self.services.dropLast())).filter { Self.services.contains($0) }
    }
    func allows(_ platform: String) -> Bool { platform == "local" || enabled.contains(platform) }
    func set(_ service: String, enabled value: Bool) {
        guard Self.services.contains(service) else { return }
        let values = Set(value ? enabled + [service] : enabled.filter { $0 != service })
        enabled = Self.services.filter { values.contains($0) }
        defaults.set(enabled, forKey: "streaming-services")
        changed?(enabled)
    }
    func binding(_ service: String) -> Binding<Bool> { Binding(get: { self.allows(service) }, set: { self.set(service, enabled: $0) }) }
    static func genreLabel(_ genre: String) -> String { ["r&b": "R&B", "edm": "EDM" ][genre.lowercased()] ?? genre.capitalized }
    static func label(_ service: String) -> String {
        switch service { case "spotify": return "Spotify"; case "youtube": return "YouTube"; case "ytmusic": return "YouTube Music"; case "soundcloud": return "SoundCloud"; default: return "Audius" }
    }
}
struct StreamingSettings: View {
    @ObservedObject private var services = StreamingPreferences.shared
    var body: some View {
        Section {
            ForEach(StreamingPreferences.services, id: \.self) { service in
                Toggle(StreamingPreferences.label(service), isOn: services.binding(service))
            }
            Link("Explore Audius", destination: URL(string: "https://audius.co")!)
        } header: { Text("Streaming services") } footer: {
            Text("Choose which services Cuda uses for search, recommendations and automatic playback. These choices apply to this device. Your saved songs, account setup and offline audio stay available. Audius offers its public, ungated catalog and is off until you enable it. Genre discovery looks up song and artist names in MusicBrainz and the iTunes catalog.")
        }
    }
}
struct RecommendationResponse: Decodable {
    var tracks: [Track]?
    var genres: [String]?
    var genre: String?
    var learned: [Track]?
}
