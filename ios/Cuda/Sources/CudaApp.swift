import SwiftUI
import UIKit

@main
struct CudaApp: App {
    @StateObject private var store = Store.shared
    @UIApplicationDelegateAdaptor(CudaApplicationDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase
    @AppStorage("appearance") private var appearance = "system"
    var body: some Scene {
        WindowGroup {
            RootView(store: store, player: store.player)
                .tint(.blue)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .onOpenURL { if $0.scheme == "cuda-sync" { store.deviceSync.offer($0) } else { store.spotify.handle($0) } }
                .modifier(UpdatePrompt())
                .modifier(DeviceSyncPrompt(sync: store.deviceSync))
                .onChange(of: phase) { _, phase in
                    if phase == .active { AppUpdates.shared.activate(); store.spotify.foreground(); store.deviceSync.activate(true) }
                    if phase != .active { store.spotify.background() }
                    if phase == .background { store.deviceSync.activate(false) }
                }
                .onAppear {
                    AppUpdates.shared.activate()
                    store.deviceSync.activate(true)
                    #if DEBUG
                    store.seedPreview()
                    #endif
                }
        }
    }
}

@MainActor
final class CudaApplicationDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Store.shared.deviceSync.registerBackground(); return true
    }
}
