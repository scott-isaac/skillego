import SwiftUI

/// Layers tile -> covered "?" or piece+player-color (+burning badge) -> selection/
/// valid-move highlight, mirroring board.js's renderCell layering order.
struct CellView: View {
    let piece: Piece?
    let covered: Bool
    let tileIndex: Int
    let spriteKey: String?
    let isSelected: Bool
    let isValidDestination: Bool

    var body: some View {
        ZStack {
            tileImage
            content
            if isSelected {
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color.yellow, lineWidth: 3)
            } else if isValidDestination {
                Circle()
                    .fill(Color.green.opacity(0.55))
                    .padding(piece == nil ? 14 : 4)
                    .allowsHitTesting(false)
            }
        }
        .clipped()
        .contentShape(Rectangle())
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
    private var content: some View {
        if let piece {
            if covered {
                if let coveredImage = GameAssetImage.covered {
                    Image(uiImage: coveredImage).resizable().scaledToFit().padding(6)
                }
            } else {
                ZStack {
                    if let player = GameAssetImage.player(color: playerArtColor[safe: piece.player] ?? "") {
                        Image(uiImage: player).resizable().scaledToFit().padding(3)
                    }
                    if let key = spriteKey, let sprite = GameAssetImage.piece(spriteKey: key) {
                        Image(uiImage: sprite).resizable().scaledToFit().padding(6)
                    }
                    if piece.isBurning {
                        Text("🔥")
                            .font(.caption)
                            .padding(2)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    }
                }
            }
        }
    }
}
