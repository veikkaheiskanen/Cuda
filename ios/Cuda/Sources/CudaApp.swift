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
                .alert("Pair with this Cuda Mac?", isPresented: Binding(get: { store.deviceSync.pendingPair != nil }, set: { if !$0 { store.deviceSync.pendingPair = nil } })) {
                    Button("Pair & sync") { if let candidate = store.deviceSync.pendingPair { Task { await store.deviceSync.pair(candidate) } } }
                    Button("Cancel", role: .cancel) { store.deviceSync.pendingPair = nil }
                } message: { Text("Your playlists, favourites and offline songs will sync with the Mac whose pairing code you scanned. Use this only with your own Mac.") }
                .onChange(of: phase) { _, phase in
                    if phase == .active { store.spotify.foreground(); store.deviceSync.activate(true) }
                    if phase == .background { store.spotify.background(); store.deviceSync.activate(false) }
                }
                .onAppear {
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
