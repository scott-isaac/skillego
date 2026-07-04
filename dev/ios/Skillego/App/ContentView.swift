import SwiftUI

struct ContentView: View {
    @State private var appState = AppState()

    var body: some View {
        Group {
            switch appState.route {
            case .setup:
                SetupView()
            case .playing(let config):
                GameScreenView(config: config)
            }
        }
        .environment(appState)
        .task {
            await appState.loadConstantsIfNeeded()
        }
    }
}

#Preview {
    ContentView()
}
