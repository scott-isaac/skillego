import SwiftUI

/// Matches styles.css's #turn-indicator: gold (#FFD700) Cinzel-style bold
/// serif text with a layered gold-glow + black-drop-shadow text-shadow,
/// meant to echo the "Skillego" logo's own lettering. `fontScale` lets the
/// caller size it proportionally to however zoomed-in the board frame is.
struct TurnIndicatorView: View {
    let snapshot: GameSnapshot?
    let isCpuThinking: Bool
    let playerColors: [String: String]
    var fontScale: CGFloat = 1

    var body: some View {
        HStack(spacing: 6 * fontScale) {
            if let snapshot {
                Circle()
                    .fill(Color(hex: playerColors[String(snapshot.currentPlayer)] ?? "#999999"))
                    .frame(width: 16 * fontScale, height: 16 * fontScale)
                Text(isCpuThinking ? "Player \(snapshot.currentPlayer) (CPU)…" : "Player \(snapshot.currentPlayer)'s turn")
                    .font(.system(size: 34 * fontScale, weight: .bold, design: .serif))
                    .tracking(1.5 * fontScale)
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    .foregroundStyle(Color(hex: "FFD700"))
                    .shadow(color: .black.opacity(0.95), radius: 2 * fontScale, x: 1, y: 2)
                    .shadow(color: .black.opacity(0.7), radius: 3 * fontScale, x: -1, y: -1)
                    .shadow(color: Color(hex: "FFC83C").opacity(0.55), radius: 10 * fontScale)
            }
        }
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
