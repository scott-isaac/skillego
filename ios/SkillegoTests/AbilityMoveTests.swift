import XCTest
@testable import Skillego

/// Exercises LocalEngine.availableDestinations (not just the raw JS functions,
/// already covered by JSEngineTests) for every special ability, since that's
/// the Swift-side glue the skill tray actually depends on.
final class AbilityMoveTests: XCTestCase {
    private func piece(_ type: String, power: Int, player: Int = 1, burning: Bool = false) -> Piece {
        Piece(type: type, power: power, player: player, burning: burning, quantity: nil, emoji: nil)
    }

    private func emptyBoard(rows: Int, cols: Int) -> [[Piece?]] {
        Array(repeating: Array(repeating: nil, count: cols), count: rows)
    }

    func testMouseHopAvailable() async throws {
        let engine = LocalEngine()
        var board = emptyBoard(rows: 4, cols: 4)
        board[1][1] = piece("mouse", power: 1)
        board[1][2] = piece("cat", power: 2)
        let covered = Array(repeating: Array(repeating: false, count: 4), count: 4)
        try await engine.debugLoadState(board: board, covered: covered, abilities: ["hop"])

        let moves = await engine.availableDestinations(row: 1, col: 1)
        XCTAssertTrue(moves.contains { $0.type == "hop" && $0.toR == 1 && $0.toC == 3 }, "expected a hop move, got \(moves)")
    }

    func testDragonEngulfAvailableOnlyWhenEnabled() async throws {
        let engine = LocalEngine()
        var board = emptyBoard(rows: 3, cols: 3)
        board[1][1] = piece("dragon", power: 6)
        let covered = Array(repeating: Array(repeating: false, count: 3), count: 3)

        try await engine.debugLoadState(board: board, covered: covered, abilities: [])
        let disabled = await engine.availableDestinations(row: 1, col: 1)
        XCTAssertFalse(disabled.contains { $0.type == "engulf" }, "engulf should be absent when not enabled")

        try await engine.debugLoadState(board: board, covered: covered, abilities: ["engulf"])
        let enabled = await engine.availableDestinations(row: 1, col: 1)
        XCTAssertTrue(enabled.contains { $0.type == "engulf" && $0.r == 1 && $0.c == 1 }, "expected an engulf move, got \(enabled)")
    }

    func testDragonPushAvailable() async throws {
        let engine = LocalEngine()
        var board = emptyBoard(rows: 4, cols: 4)
        board[1][1] = piece("dragon", power: 6)
        board[1][2] = piece("mouse", power: 1, player: 2)
        let covered = Array(repeating: Array(repeating: false, count: 4), count: 4)
        try await engine.debugLoadState(board: board, covered: covered, abilities: ["push"])

        let moves = await engine.availableDestinations(row: 1, col: 1)
        XCTAssertTrue(moves.contains { $0.type == "push" && $0.enemyR == 1 && $0.enemyC == 2 }, "expected a push move, got \(moves)")
    }

    func testWizardTransformAvailable() async throws {
        let engine = LocalEngine()
        var board = emptyBoard(rows: 5, cols: 5)
        board[2][2] = piece("wizard", power: 4)
        let covered = Array(repeating: Array(repeating: false, count: 5), count: 5)
        try await engine.debugLoadState(board: board, covered: covered, abilities: ["transform"])

        let moves = await engine.availableDestinations(row: 2, col: 2)
        XCTAssertTrue(moves.contains { $0.type == "transform" }, "expected a transform move, got \(moves)")
        XCTAssertTrue(moves.contains { $0.type == "transform" && $0.isExplosion == true }, "expected an explode option, got \(moves)")
    }

    func testRobotSnipeAvailableWithCatSpotter() async throws {
        let engine = LocalEngine()
        var board = emptyBoard(rows: 4, cols: 4)
        board[0][0] = piece("robot", power: 5)
        board[0][3] = piece("mouse", power: 1, player: 2)
        board[1][3] = piece("cat", power: 2)
        let covered = Array(repeating: Array(repeating: false, count: 4), count: 4)
        try await engine.debugLoadState(board: board, covered: covered, abilities: ["snipe"])

        let moves = await engine.availableDestinations(row: 0, col: 0)
        XCTAssertTrue(moves.contains { $0.type == "snipe" && $0.targetR == 0 && $0.targetC == 3 }, "expected a snipe move, got \(moves)")
    }

    func testPyromaniaAvailableOnBurningPiece() async throws {
        let engine = LocalEngine()
        var board = emptyBoard(rows: 3, cols: 3)
        board[1][1] = piece("dragon", power: 4, burning: true)
        board[1][2] = piece("cat", power: 2, player: 2)
        let covered = Array(repeating: Array(repeating: false, count: 3), count: 3)
        try await engine.debugLoadState(board: board, covered: covered, abilities: ["pyromania"])

        let moves = await engine.availableDestinations(row: 1, col: 1)
        XCTAssertTrue(moves.contains { $0.type == "pyro" && $0.targetR == 1 && $0.targetC == 2 }, "expected a pyro move, got \(moves)")
    }

    func testCoveredCellOnlyOffersUncover() async throws {
        let engine = LocalEngine()
        var board = emptyBoard(rows: 3, cols: 3)
        board[1][1] = piece("dragon", power: 6)
        var covered = Array(repeating: Array(repeating: false, count: 3), count: 3)
        covered[1][1] = true
        try await engine.debugLoadState(board: board, covered: covered, abilities: ["push", "engulf"])

        let moves = await engine.availableDestinations(row: 1, col: 1)
        XCTAssertEqual(moves, [GameMove(type: "uncover", r: 1, c: 1)])
    }
}
