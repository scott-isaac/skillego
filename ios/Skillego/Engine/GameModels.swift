import Foundation

// Mirrors the JSON piece shape produced by js/no-modules/{constants,rules,cpu}.js.
// `quantity`/`emoji` are only present on freshly-dealt pieces (assignPieces spreads
// the PIECES definition, which carries them); `burning` is absent until a piece is
// set alight. All three are therefore optional here rather than defaulted server-side.
struct Piece: Codable, Equatable {
    var type: String
    var power: Int
    var player: Int
    var burning: Bool?
    var quantity: Int?
    var emoji: String?

    var isBurning: Bool { burning ?? false }
}

struct BoardCell: Codable, Equatable {
    var row: Int
    var col: Int
}

struct MoveCell: Codable, Equatable {
    var r: Int
    var c: Int
}

// Deliberately flat/dictionary-shaped (mirrors the JS move union: {type, ...fields})
// rather than a Swift enum with associated values — a direct 1:1 JSON round-trip
// with rules.js's applyMoveToState, GameRoom.js, and SkillMinimax/ClassicAI's
// returned moves, all of which already use exactly this field set.
struct GameMove: Codable, Equatable {
    var type: String   // "uncover"|"move"|"capture"|"push"|"hop"|"engulf"|"transform"|"snipe"|"pyro"

    // uncover, engulf
    var r: Int?
    var c: Int?

    // move, capture, hop, pyro (from/to)
    var fromR: Int?
    var fromC: Int?
    var toR: Int?
    var toC: Int?
    var capPower: Int?

    // push
    var drR: Int?
    var drC: Int?
    var enemyR: Int?
    var enemyC: Int?
    var destR: Int?
    var destC: Int?

    // transform
    var wizR: Int?
    var wizC: Int?
    var cells: [MoveCell]?
    var isExplosion: Bool?

    // snipe
    var robotR: Int?
    var robotC: Int?
    var targetR: Int?
    var targetC: Int?
    var spotterR: Int?
    var spotterC: Int?
}

struct GameSnapshot: Codable, Equatable {
    var board: [[Piece?]]
    var covered: [[Bool]]
    var pushBlocked: [BoardCell]
    var currentPlayer: Int
    var numPlayers: Int
    var eliminatedPlayers: [Int]
    var enabledAbilities: [String]
    var gameOver: Bool
    var winner: Int?
}

struct PlayerConfig: Codable, Equatable {
    var type: String            // "human" | "cpu"
    var difficulty: String?     // "easy" | "medium" | "hard" | "expert"
}

struct GameSetupConfig: Codable, Equatable {
    var numPlayers: Int
    var players: [Int: PlayerConfig]
    var enabledAbilities: [String]
    var cpuMoveDelayMs: Int
}

enum GameEngineEvent {
    case cpuThinking(player: Int)
    case moveRejected(reason: String)
    case opponentDisconnected(player: Int)
    case opponentReconnected(player: Int)
    case opponentLeft(player: Int)
    case gameOver(winner: Int?, reason: String?)
    case error(String)
}
