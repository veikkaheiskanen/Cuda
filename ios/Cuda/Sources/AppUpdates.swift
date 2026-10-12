import SwiftUI

@MainActor
final class AppUpdates: ObservableObject {
    static let shared = AppUpdates()
    @Published var checking = false
    @Published var available: ReleaseUpdate?
    @Published var prompt: ReleaseUpdate?
    @Published var status = "Checks Cuda’s GitHub releases automatically."
    @Published var lastCheck: Date?
    @Published var automatic: Bool { didSet { defaults.set(automatic, forKey: "update-checks"); if !automatic { task?.cancel(); prompt = nil } } }
    private let defaults: UserDefaults
    private let session: URLSession
    private let currentVersion: String
    private var task: Task<Void, Never>?
    init(defaults: UserDefaults = .standard, session: URLSession = .shared, version: String? = nil) {
        self.defaults = defaults; self.session = session; currentVersion = version ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        automatic = defaults.object(forKey: "update-checks") as? Bool ?? true
        lastCheck = defaults.object(forKey: "update-last-check") as? Date
    }
    func activate() {
        guard automatic, !checking, lastCheck == nil || Date().timeIntervalSince(lastCheck!) > 6 * 3600,
              ProcessInfo.processInfo.environment["CUDA_DEMO"] != "1" else { return }
        task = Task { await check(manual: false) }
    }
    func check(manual: Bool = true) async {
        guard !checking else { return }; checking = true; defer { checking = false }
        status = "Checking GitHub releases…"
        do {
            var request = URLRequest(url: URL(string: "https://api.github.com/repos/veikkaheiskanen/Cuda/releases?per_page=100")!)
            request.timeoutInterval = 20; request.cachePolicy = .reloadIgnoringLocalCacheData
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
            request.setValue("Cuda-iOS/" + currentVersion, forHTTPHeaderField: "User-Agent")
            let (data, response) = try await session.data(for: request)
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode), data.count <= 2_000_000 else { throw CudaError.message("GitHub could not check updates right now. Try again later.") }
            let releases = try JSONDecoder().decode([GitHubRelease].self, from: data)
            available = ReleaseUpdate.latestIOS(releases, current: currentVersion)
            lastCheck = Date(); defaults.set(lastCheck, forKey: "update-last-check")
            if let update = available {
                status = "Cuda \(update.version) is available."
                if manual || (automatic && defaults.string(forKey: "update-notified-version") != update.version) {
                    prompt = update; defaults.set(update.version, forKey: "update-notified-version")
                }
            } else { status = "Cuda is up to date." }
        } catch is CancellationError { status = "Automatic update checks are off." }
        catch { status = "Update check paused. " + error.localizedDescription }
    }
}
struct UpdateSettings: View {
    @ObservedObject private var updates = AppUpdates.shared
    @Environment(\.openURL) private var openURL
    var body: some View {
        Section {
            Toggle("Automatically check for updates", isOn: $updates.automatic)
            Button { Task { await updates.check() } } label: { HStack { Text("Check for updates"); Spacer(); if updates.checking { ProgressView() } } }.disabled(updates.checking)
            Text(updates.status).font(.subheadline).foregroundStyle(.secondary)
            if let update = updates.available {
                Button("Download Cuda \(update.version)", systemImage: "arrow.down.circle") { openURL(update.downloadURL) }
                Link("Release notes", destination: update.releaseURL)
            }
            Link("All releases", destination: URL(string: "https://github.com/veikkaheiskanen/Cuda/releases")!)
            if let date = updates.lastCheck { LabeledContent("Last checked") { Text(date, style: .relative).foregroundStyle(.secondary) } }
        } header: { Text("Updates") } footer: {
            Text("Cuda checks GitHub releases when you open it. Download updates, then sign and install them with Sideloadly on your Mac using the same Apple ID and bundle ID. iPhone updates need that signing step.")
        }
    }
}
struct UpdatePrompt: ViewModifier {
    @ObservedObject private var updates = AppUpdates.shared
    @Environment(\.openURL) private var openURL
    func body(content: Content) -> some View {
        content.alert(item: $updates.prompt) { update in
            Alert(title: Text("Cuda \(update.version) is available"), message: Text("Download the IPA, then update using Sideloadly on your Mac. Keep the same Apple ID and bundle ID to preserve your music and settings."), primaryButton: .default(Text("Download update")) { openURL(update.downloadURL) }, secondaryButton: .cancel(Text("Later")))
        }
    }
}
