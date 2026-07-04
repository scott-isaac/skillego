import SwiftUI

/// Layers tile -> covered "?" or piece+player-color (+burning glow) -> selection/
/// valid-move/valid-capture highlight, mirroring board.js's renderCell layering
/// order and styles.css's .cell.selected/.valid-move/.valid-capture/.burning
/// effects (animated glows, not static borders/fills).
struct CellView: View {
    let piece: Piece?
    let covered: Bool
    let tileIndex: Int
    let spriteKey: String?
    let isSelected: Bool
    let destinationKind: DestinationKind?

    @State private var pulse = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                tileImage
                content(size: geo.size)
                if isSelected {
                    selectionGlow(size: geo.size)
                }
                if destinationKind == .move {
                    moveDot(size: geo.size)
                } else if destinationKind == .capture {
                    captureBrackets(size: geo.size)
                }
            }
        }
        .clipped()
        .contentShape(Rectangle())
        .onAppear { pulse = true }
    }

    @ViewBuilder
    private var tileImage: some View {
        if let tile = GameAssetImage.tile(tileIndex) {
            Image(uiImage: tile).resizable().scaledToFill()
        } else {
            Color(white: 0.85)
        }
    }

    @ViewBuilder
    private func content(size: CGSize) -> some View {
        if let piece {
            if covered {
                if let coveredImage = GameAssetImage.covered {
                    Image(uiImage: coveredImage).resizable().scaledToFit().padding(6)
                }
            } else {
                let color = playerArtColor[safe: piece.player] ?? ""
                ZStack {
                    if let player = GameAssetImage.player(color: color) {
                        Image(uiImage: player).resizable().scaledToFit().padding(3)
                    }
                    // Sits between the player-color square and the piece sprite,
                    // matching board.js's renderCell background-image order
                    // (piece_*.png, gifs/fire_*.gif, player_*.png, front-to-back)
                    // and its background-size ('107% 72%' for the burning layer).
                    if piece.isBurning, !color.isEmpty {
                        AnimatedGIFView(name: "fire_\(color)")
                            .frame(width: size.width * 1.07, height: size.height * 0.72)
                    }
                    if let key = spriteKey, let sprite = GameAssetImage.piece(spriteKey: key) {
                        Image(uiImage: sprite).resizable().scaledToFit().padding(6)
                    }
                }
                .modifier(BurningGlow(isBurning: piece.isBurning))
            }
        }
    }

    // Mirrors .cell.selected / @keyframes select-pulse: a pulsing multi-layer
    // gold/amber glow around an 85%-of-cell rounded square, not a static border.
    private func selectionGlow(size: CGSize) -> some View {
        let side = min(size.width, size.height) * 0.85
        return RoundedRectangle(cornerRadius: 6)
            .stroke(Color(hex: "FFDC64").opacity(0.8), lineWidth: 2)
            .frame(width: side, height: side)
            .shadow(color: Color(hex: "FFDC64").opacity(pulse ? 1.0 : 0.9), radius: pulse ? 4 : 3)
            .shadow(color: Color(hex: "FFB428").opacity(pulse ? 0.6 : 0.5), radius: pulse ? 10 : 8)
            .shadow(color: Color(hex: "C88C14").opacity(pulse ? 0.25 : 0.2), radius: pulse ? 18 : 15)
            .allowsHitTesting(false)
            .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
    }

    // Mirrors .cell.valid-move: a soft green filled circle with a glow.
    private func moveDot(size: CGSize) -> some View {
        let side = min(size.width, size.height) * 0.32
        return Circle()
            .fill(Color(red: 130 / 255, green: 200 / 255, blue: 110 / 255).opacity(0.55))
            .frame(width: side, height: side)
            .shadow(color: Color(red: 120 / 255, green: 200 / 255, blue: 100 / 255).opacity(0.4), radius: 6)
            .allowsHitTesting(false)
    }

    // Mirrors .cell.valid-capture: glowing orange-red corner brackets (top-left
    // + bottom-right L-shapes) rather than a filled dot, since capturing is a
    // materially different action from a plain move.
    private func captureBrackets(size: CGSize) -> some View {
        let side = min(size.width, size.height) * 0.28
        let inset = min(size.width, size.height) * 0.04
        let color = Color(red: 1, green: 90 / 255, blue: 60 / 255).opacity(0.8)
        return ZStack {
            CornerBracket(corner: .topLeading)
                .stroke(color, lineWidth: 3)
                .frame(width: side, height: side)
                .position(x: inset + side / 2, y: inset + side / 2)
            CornerBracket(corner: .bottomTrailing)
                .stroke(color, lineWidth: 3)
                .frame(width: side, height: side)
                .position(x: size.width - inset - side / 2, y: size.height - inset - side / 2)
        }
        .shadow(color: color.opacity(0.5), radius: 4)
        .allowsHitTesting(false)
    }
}

private struct CornerBracket: Shape {
    enum Corner { case topLeading, bottomTrailing }
    let corner: Corner

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch corner {
        case .topLeading:
            path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        case .bottomTrailing:
            path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        }
        return path
    }
}

// Mirrors .cell.burning / @keyframes burn-flicker: animated inset+outer
// orange glow. The fire gif itself (added alongside this modifier) now
// carries the "this piece is burning" signal, so no separate badge is needed.
private struct BurningGlow: ViewModifier {
    let isBurning: Bool
    @State private var flicker = false

    func body(content: Content) -> some View {
        content
            .shadow(color: isBurning ? Color.orange.opacity(flicker ? 0.5 : 0.35) : .clear, radius: flicker ? 12 : 7)
            .animation(isBurning ? .easeInOut(duration: 0.45).repeatForever(autoreverses: true) : .default, value: flicker)
            .onAppear { if isBurning { flicker = true } }
    }
}
