import AppKit
import Sparkle

@MainActor
final class ProbeDriver: NSObject, SPUUserDriver {
    private func log(_ value: String) {
        let file = URL(fileURLWithPath: CommandLine.arguments[1])
        let old = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        try? (old + value + "\n").write(to: file, atomically: true, encoding: .utf8)
    }
    func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) { reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false)) }
    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) { log("checking") }
    func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) { log("found"); reply(.install) }
    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}
    func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) { log("not-found"); acknowledgement(); NSApp.terminate(nil) }
    func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) { log("error:\((error as NSError).code):\(error.localizedDescription)"); acknowledgement(); NSApp.terminate(nil) }
    func showDownloadInitiated(cancellation: @escaping () -> Void) { log("download") }
    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {}
    func showDownloadDidReceiveData(ofLength length: UInt64) {}
    func showDownloadDidStartExtractingUpdate() { log("extract") }
    func showExtractionReceivedProgress(_ progress: Double) {}
    func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) { log("ready"); reply(.install) }
    func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) { log("install") }
    func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) { log("installed"); acknowledgement(); NSApp.terminate(nil) }
    func dismissUpdateInstallation() {}
}
@main struct UpdaterProbe {
    @MainActor static func main() throws {
        let app = NSApplication.shared; app.setActivationPolicy(.prohibited)
        let driver = ProbeDriver()
        let updater = SPUUpdater(hostBundle: Bundle.main, applicationBundle: Bundle.main, userDriver: driver, delegate: nil)
        try updater.start()
        updater.checkForUpdates()
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { app.terminate(nil) }
        withExtendedLifetime((driver, updater)) { app.run() }
    }
}
