import SwiftUI

struct TurnIndicatorView: View {
    let snapshot: GameSnapshot?
    let isCpuThinking: Bool
    let playerColors: [String: String]

    var body: some View {
        HStack(spacing: 8) {
            if let snapshot {
                Circle()
                    .fill(Color(hex: playerColors[String(snapshot.currentPlayer)] ?? "#999999"))
                    .frame(width: 14, height: 14)
                Text(isCpuThinking
                    ? "Player \(snapshot.currentPlayer) (CPU) is thinking…"
                    : "Player \(snapshot.currentPlayer)'s turn")
            }
        }
        .font(.headline)
        .padding(.vertical, 8)
    }
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
        var rgb: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&rgb)
        self.init(
            red: Double((rgb & 0xFF0000) >> 16) / 255,
            green: Double((rgb & 0x00FF00) >> 8) / 255,
            blue: Double(rgb & 0x0000FF) / 255
        )
    }
}
