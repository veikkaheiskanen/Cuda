import Foundation
import Combine

@MainActor
final class DiscordPresenceController: ObservableObject {
    @Published var enabled: Bool { didSet { UserDefaults.standard.set(enabled, forKey: "native-discord-enabled"); configure() } }
    @Published private(set) var applicationID: String
    @Published private(set) var status = "Off"
    private let runtime: Runtime
    private let player: Player
    private var observation: AnyCancellable?
    private var configuration = UUID()
    var validID: Bool { applicationID.range(of: "^[0-9]{17,20}$", options: .regularExpression) != nil }

    init(runtime: Runtime, player: Player) {
        self.runtime = runtime; self.player = player
        applicationID = UserDefaults.standard.string(forKey: "native-discord-application-id") ?? ""
        enabled = UserDefaults.standard.bool(forKey: "native-discord-enabled")
        observation = player.objectWillChange.throttle(for: .seconds(1), scheduler: RunLoop.main, latest: true).sink { [weak self] in
            // Published values change just after objectWillChange fires.
            Task { @MainActor in await Task.yield(); await self?.update() }
        }
    }
    func start() { configure() }
    func saveApplicationID(_ value: String) {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.isEmpty || value.range(of: "^[0-9]{17,20}$", options: .regularExpression) != nil else { status = "Enter a valid Discord Application ID."; return }
        if value.isEmpty { enabled = false }
        applicationID = value; UserDefaults.standard.set(value, forKey: "native-discord-application-id"); configure()
    }
    func receive(_ value: [String: Any]) { if let message = value["message"] as? String { status = message } }
    private func configure() {
        guard runtime.ready else { return }
        let key = UUID(); configuration = key
        Task {
            do {
                let data = try await runtime.call("discordConfigure", ["enabled": enabled, "clientID": applicationID])
                guard configuration == key else { return }
                if let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] { receive(value) }
                await update()
            } catch { if configuration == key { status = error.localizedDescription } }
        }
    }
    private func update() async {
        guard enabled, validID, runtime.ready else { return }
        var args: [String: Any] = ["playing": player.playing, "loading": player.loading || player.error != nil,
            "position": player.position.isFinite ? player.position : 0, "duration": player.duration.isFinite ? player.duration : 0, "speed": player.effects.speed]
        if let track = player.current {
            var value: [String: Any] = ["title": track.title, "artist": track.artist, "platform": track.platform, "url": track.url]
            if let thumbnail = track.thumbnail { value["thumbnail"] = thumbnail }
            if let album = track.album { value["album"] = album }
            args["track"] = value
        }
        // Presence failures must never interrupt music playback.
        do { _ = try await runtime.call("discordUpdate", args) }
        catch { status = "Discord is unavailable. Your music keeps playing." }
    }
}
