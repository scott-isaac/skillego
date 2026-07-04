import UIKit

// Loads the PNGs copy-js-engine.sh bundles into GameAssets/ (see
// ios/scripts/copy-js-engine.sh), matching board.js's asset naming exactly:
// piece_{spriteKey}.png, piece_uncovered.png (covered-cell "?"), player_{color}.png,
// tile_{1|2|3}.png. Not an asset catalog by design — see the iOS plan's asset
// section — so this loads straight from bundle resources with basic caching.
//
// v1 simplification: board.js also composites an animated fire_{color}.gif over
// burning pieces; this loader intentionally doesn't play GIFs yet (CellView
// shows a static 🔥 badge instead) — real GIF playback is a follow-up, not
// required for the game to be playable.
enum GameAssetImage {
    private static var cache: [String: UIImage] = [:]

    static func piece(spriteKey: String) -> UIImage? {
        png("piece_\(spriteKey)")
    }

    static let covered = png("piece_uncovered")

    // Decorative frame behind the 6x6 (2-player) board — mirrors styles.css's
    // #board-frame background. Not used in 4-player mode; the web app drops it
    // there too since the art is sized for a 6x6 layout (see styles.css's
    // #board-frame.mode-4p comment).
    static let boardFrame = png("board")

    static func player(color: String) -> UIImage? {
        guard !color.isEmpty else { return nil }
        return png("player_\(color)")
    }

    static func tile(_ index: Int) -> UIImage? {
        png("tile_\(index)")
    }

    private static func png(_ name: String) -> UIImage? {
        if let cached = cache[name] { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "GameAssets"),
              let image = UIImage(contentsOfFile: url.path) else {
            return nil
        }
        cache[name] = image
        return image
    }
}

// Player number (1-4) -> asset color name, mirroring board.js's PLAYER_ART array.
let playerArtColor = ["", "red", "blue", "yellow", "green"]
