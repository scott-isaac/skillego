import SwiftUI

/// Maps LocalEngine's ability-move results (push/hop/engulf/transform/snipe/
/// pyro) to a row of tap-to-submit buttons. These can't be represented as a
/// plain board-cell tap the way move/capture destinations are — a push and a
/// plain capture can both target the same adjacent enemy square, so the player
/// must explicitly choose which action they mean (mirrors game.js's skill
/// tray, which exists for exactly this reason).
struct SkillTrayView: View {
    let moves: [GameMove]
    let onSelect: (GameMove) -> Void

    var body: some View {
        if !moves.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(moves.enumerated()), id: \.offset) { _, move in
                        if let info = Self.buttonInfo(for: move) {
                            Button {
                                onSelect(move)
                            } label: {
                                VStack(spacing: 2) {
                                    Text(info.icon).font(.title2)
                                    Text(info.label).font(.caption2)
                                }
                                .padding(8)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    }
                }
                .padding(.horizontal)
            }
            .frame(height: 64)
        }
    }

    private static func arrow(_ dr: Int, _ dc: Int) -> String {
        switch (dr, dc) {
        case (-1, 0): return "↑"
        case (1, 0): return "↓"
        case (0, -1): return "←"
        case (0, 1): return "→"
        default: return "•"
        }
    }

    private static func sign(_ value: Int) -> Int { value > 0 ? 1 : (value < 0 ? -1 : 0) }

    private static func buttonInfo(for move: GameMove) -> (icon: String, label: String)? {
        switch move.type {
        case "push":
            guard let drR = move.drR, let drC = move.drC, let enemyR = move.enemyR, let enemyC = move.enemyC else { return nil }
            return ("💨\(arrow(enemyR - drR, enemyC - drC))", "Push")
        case "hop":
            guard let fromR = move.fromR, let fromC = move.fromC, let toR = move.toR, let toC = move.toC else { return nil }
            return ("🐾\(arrow((toR - fromR) / 2, (toC - fromC) / 2))", "Hop")
        case "engulf":
            return ("🔥", "Enflame")
        case "transform":
            if move.isExplosion == true { return ("✦", "Explode") }
            guard let wizR = move.wizR, let wizC = move.wizC, let step = move.cells?[safe: 1] else { return nil }
            return ("🧙\(arrow(step.r - wizR, step.c - wizC))", "Transform")
        case "snipe":
            guard let robotR = move.robotR, let robotC = move.robotC, let targetR = move.targetR, let targetC = move.targetC else { return nil }
            return ("🤖\(arrow(sign(targetR - robotR), sign(targetC - robotC)))", "Snipe")
        case "pyro":
            guard let fromR = move.fromR, let fromC = move.fromC, let targetR = move.targetR, let targetC = move.targetC else { return nil }
            return ("🔥\(arrow(targetR - fromR, targetC - fromC))", "Spread")
        default:
            return nil
        }
    }
}
