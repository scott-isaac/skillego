import SwiftUI

struct WinnerOverlayView: View {
    let winner: Int?
    let onRematch: () -> Void
    let onNewGame: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(winner.map { "Player \($0) wins!" } ?? "Draw")
                .font(.largeTitle.bold())
            HStack(spacing: 12) {
                Button("Rematch", action: onRematch).buttonStyle(.borderedProminent)
                Button("New Game", action: onNewGame).buttonStyle(.bordered)
            }
        }
        .padding(24)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 20)
    }
}
