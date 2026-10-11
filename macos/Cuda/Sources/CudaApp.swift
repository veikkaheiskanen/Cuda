import SwiftUI
import AppKit

@main
struct CudaNativeApp: App {
    @StateObject private var store = Store()
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    var body: some Scene {
        Window("Cuda", id: "main") {
            RootView(store: store, player: store.player)
                .tint(.blue)
                .onAppear { Appearance.apply(ProcessInfo.processInfo.environment["CUDA_NATIVE_THEME"] ?? UserDefaults.standard.string(forKey: "native-theme") ?? "system"); AppDelegate.runtime = store.runtime; AppDelegate.player = store.player }
        }.defaultSize(width: 1120, height: 780).windowToolbarStyle(.unified)
        .commands { CudaCommands(store: store); SidebarCommands() }
        Window("Cuda Mini Player", id: "mini") {
            MiniPlayerWindow(player: store.player).frame(minWidth: 350, minHeight: 90).padding(12)
        }.defaultSize(width: 460, height: 120).windowResizability(.contentMinSize)
        Settings { SettingsView(store: store).frame(width: 640, height: 700) }
    }
}
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static weak var runtime: Runtime?
    static weak var player: Player?
    private var keyboardMonitor: Any?
    func applicationDidFinishLaunching(_ notification: Notification) {
        keyboardMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.charactersIgnoringModifiers == " ", event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty, !(NSApp.keyWindow?.firstResponder is NSTextView) {
                Self.player?.toggle(); return nil
            }
            return event
        }
    }
    func applicationWillTerminate(_ notification: Notification) { if let keyboardMonitor { NSEvent.removeMonitor(keyboardMonitor) }; Self.runtime?.stop() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
struct CudaCommands: Commands {
    @ObservedObject var store: Store
    @Environment(\.openWindow) private var openWindow
    var body: some Commands {
        CommandGroup(replacing: .newItem) { Button("Import Music…") { store.importAudio() }.keyboardShortcut("o"); Button("Open Cuda Window") { openWindow(id: "main") }.keyboardShortcut("n") }
        CommandGroup(after: .appInfo) { Button("Cuda Source & Help") { NSWorkspace.shared.open(URL(string: "https://github.com/veikkaheiskanen/Cuda")!) } }
        CommandMenu("Playback") {
            Button("Play / Pause") { store.player.toggle() }
            Button("Next Song") { store.player.next() }.keyboardShortcut(.rightArrow)
            Button("Previous Song") { store.player.previous() }.keyboardShortcut(.leftArrow)
            Button("Now Playing") { NotificationCenter.default.post(name: .cudaPlayer, object: nil) }.keyboardShortcut("p", modifiers: [.command, .shift])
            Button("Mini Player") { openWindow(id: "mini") }.keyboardShortcut("m", modifiers: [.command, .shift])
        }
        CommandGroup(after: .textEditing) { Button("Search Music") { NotificationCenter.default.post(name: .cudaSearch, object: nil) }.keyboardShortcut("f"); Button("Home") { NotificationCenter.default.post(name: .cudaHome, object: nil) }.keyboardShortcut("h", modifiers: [.command, .shift]) }
    }
}
struct MiniPlayerWindow: View {
    @ObservedObject var player: Player
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Group {
            if player.current != nil { CompactPlayer(player: player) { openWindow(id: "main"); NotificationCenter.default.post(name: .cudaPlayer, object: nil) } }
            else { HStack { Image(systemName: "music.note"); Text("Choose a song in Cuda").foregroundStyle(.secondary); Spacer(); Button("Open Cuda") { openWindow(id: "main") } }.padding(16) }
        }
    }
}
#if DEBUG
@MainActor
enum NativeCapture {
    static func save() {
        guard let output = ProcessInfo.processInfo.environment["CUDA_NATIVE_PROFILE"], let window = NSApp.windows.first(where: { $0.title == "Cuda" }) else { return }
        let values: [String: Any] = ["native": true, "frame": NSStringFromRect(window.frame), "title": window.title, "viewClass": String(describing: type(of: window.contentView!)), "titled": window.styleMask.contains(.titled), "resizable": window.styleMask.contains(.resizable)]
        try? JSONSerialization.data(withJSONObject: values, options: .prettyPrinted).write(to: URL(fileURLWithPath: output).appendingPathComponent("native-ready.json"))
    }
}
#endif
