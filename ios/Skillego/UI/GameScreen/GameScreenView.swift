import SwiftUI

struct GameScreenView: View {
    let config: GameSetupConfig
    @Environment(AppState.self) private var appState
    @State private var viewModel: GameSessionViewModel?

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel: viewModel)
            } else {
                ProgressView()
            }
        }
        .task {
            guard viewModel == nil else { return }
            let vm = GameSessionViewModel(config: config, engine: appState.localEngine)
            viewModel = vm
            await vm.start()
        }
        .onDisappear {
            viewModel?.stopObserving()
        }
    }

    @ViewBuilder
    private func content(viewModel: GameSessionViewModel) -> some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()

            BoardView(
                viewModel: viewModel,
                playerColors: appState.constants?.playerColors ?? [:],
                onResign: { viewModel.resign() }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea(edges: .bottom)

            if let snapshot = viewModel.snapshot, snapshot.gameOver {
                Color.black.opacity(0.4).ignoresSafeArea()
                WinnerOverlayView(
                    winner: snapshot.winner,
                    onRematch: { viewModel.requestRematch() },
                    onNewGame: { appState.returnToSetup() }
                )
            }
        }
        .alert("Error", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { isPresented in if !isPresented { viewModel.errorMessage = nil } }
        )) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }
}
