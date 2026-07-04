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

    /// board.png bakes exactly 5 slot rectangles into its art (see BoardView's
    /// slotRowRect) — matching game.js's own SKILL_TRAY_SLOTS constant — so
    /// this always renders 5 evenly-spaced slots (empty ones just show nothing)
    /// rather than a scrolling list, letting the caller size/position the whole
    /// row to sit exactly on top of that baked-in bracket.
    var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<5, id: \.self) { index in
                let move = moves[safe: index]
                let info = move.flatMap(Self.buttonInfo(for:))
                Button {
                    if let move { onSelect(move) }
                } label: {
                    Text(info?.icon ?? "")
                        .font(.system(size: 28))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .contentShape(Rectangle())
                }
                .disabled(info == nil)
                .accessibilityLabel(info?.label ?? "")
            }
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
