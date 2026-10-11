import SwiftUI

@main
struct CudaApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var phase
    @AppStorage("appearance") private var appearance = "system"
    var body: some Scene {
        WindowGroup {
            RootView(store: store, player: store.player)
                .tint(.blue)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .onOpenURL { store.spotify.handle($0) }
                .onChange(of: phase) { _, phase in
                    if phase == .active { store.spotify.foreground() }
                    if phase == .background { store.spotify.background() }
                }
                .onAppear {
                    #if DEBUG
                    store.seedPreview()
                    #endif
                }
        }
    }
}
