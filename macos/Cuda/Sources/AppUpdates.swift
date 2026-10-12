import SwiftUI
import Combine
import Sparkle

@MainActor
final class AppUpdates: NSObject, ObservableObject, SPUUpdaterDelegate {
    static let shared = AppUpdates()
    @Published var canCheck = false
    @Published var automaticChecks = true
    @Published var automaticDownloads = true
    @Published var lastCheck: Date?
    @Published var status = "Updates come from Cuda’s GitHub releases."
    private var started = false
    private lazy var controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
    func start() {
        guard ProcessInfo.processInfo.environment["CUDA_NATIVE_DEMO"] != "1", !started else { return }; started = true
        let updater = controller.updater
        updater.publisher(for: \.canCheckForUpdates).receive(on: RunLoop.main).assign(to: &$canCheck)
        updater.publisher(for: \.automaticallyChecksForUpdates).receive(on: RunLoop.main).assign(to: &$automaticChecks)
        updater.publisher(for: \.automaticallyDownloadsUpdates).receive(on: RunLoop.main).assign(to: &$automaticDownloads)
        updater.publisher(for: \.lastUpdateCheckDate).receive(on: RunLoop.main).assign(to: &$lastCheck)
        controller.startUpdater()
        if updater.automaticallyChecksForUpdates { updater.checkForUpdatesInBackground() }
    }
    func check() { start(); controller.checkForUpdates(nil) }
    func setChecks(_ enabled: Bool) { controller.updater.automaticallyChecksForUpdates = enabled }
    func setDownloads(_ enabled: Bool) { controller.updater.automaticallyDownloadsUpdates = enabled }
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) { status = "Cuda \(item.displayVersionString) is available." }
    func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) { status = "You’re using the latest compatible version of Cuda." }
    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) { status = "Update check paused. " + error.localizedDescription }
    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock: @escaping () -> Void) -> Bool {
        status = "Update downloaded. It will install when you quit Cuda."
        return false
    }
    func updaterWillRelaunchApplication(_ updater: SPUUpdater) { AppDelegate.player?.stop() }
}
struct UpdateSettings: View {
    @ObservedObject private var updates = AppUpdates.shared
    var body: some View {
        Section("Updates") {
            Toggle("Automatically check for updates", isOn: Binding(get: { updates.automaticChecks }, set: updates.setChecks))
            Toggle("Download and install updates automatically", isOn: Binding(get: { updates.automaticDownloads }, set: updates.setDownloads)).disabled(!updates.automaticChecks)
            HStack { Button("Check for Updates…", systemImage: "arrow.triangle.2.circlepath") { updates.check() }.disabled(!updates.canCheck); Spacer(); if let date = updates.lastCheck { Text(date, style: .date).font(.callout).foregroundStyle(.secondary) } }
            Text(updates.status).font(.callout).foregroundStyle(.secondary)
            Text("Downloaded updates install when you quit Cuda. Your music, account connections and device pairing stay in place.").font(.callout).foregroundStyle(.secondary)
        }.onAppear { updates.start() }
    }
}
