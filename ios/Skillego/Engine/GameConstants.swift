import Foundation

// Mirrors the JSON shape bridge.js's ios_getConstants() returns — sourced live
// from js/no-modules/constants.js so a new piece/ability added on the web side
// shows up here with zero Swift changes. Object-keyed fields (boardConfig,
// pieceAbilities, playerColors) use string keys because that's what JSON
// objects always have, even though the JS source keys them by number/piece type.
struct BoardDimensions: Codable, Equatable {
    var rows: Int
    var cols: Int
}

struct PieceDefinition: Codable, Equatable, Identifiable {
    var type: String
    var power: Int
    var quantity: Int
    var emoji: String
    var id: String { type }
}

struct AbilityDefinition: Codable, Equatable, Identifiable {
    var id: String
    var piece: String?
    var emoji: String
    var name: String
    var description: String
}

struct GameConstants: Codable, Equatable {
    var boardConfig: [String: BoardDimensions]
    var pieces: [PieceDefinition]
    var pieceAbilities: [String: [String]]
    var allAbilities: [AbilityDefinition]
    var playerColors: [String: String]

    func dimensions(forPlayerCount numPlayers: Int) -> BoardDimensions {
        boardConfig[String(numPlayers)] ?? BoardDimensions(rows: 6, cols: 6)
    }
}
