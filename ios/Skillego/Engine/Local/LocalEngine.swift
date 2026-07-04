import Foundation

/// GameEngineClient backed by the on-device JSContext — local single-player-vs-CPU
/// and local pass-and-play. All rule/AI logic runs in the reused JS files; this
/// class only marshals JSON in/out and, via `requestCpuMove`, drives CPU turns.
final class LocalEngine: GameEngineClient {
    private let host: JSContextHost
    private var config: GameSetupConfig?
    private var currentSnapshot: GameSnapshot?

    private let snapshotContinuation: AsyncStream<GameSnapshot>.Continuation
    let snapshots: AsyncStream<GameSnapshot>
    private let eventContinuation: AsyncStream<GameEngineEvent>.Continuation
    let events: AsyncStream<GameEngineEvent>

    init(host: JSContextHost = JSContextHost()) {
        self.host = host
        var snapshotContinuation: AsyncStream<GameSnapshot>.Continuation!
        snapshots = AsyncStream { snapshotContinuation = $0 }
        self.snapshotContinuation = snapshotContinuation

        var eventContinuation: AsyncStream<GameEngineEvent>.Continuation!
        events = AsyncStream { eventContinuation = $0 }
        self.eventContinuation = eventContinuation
    }

    // MARK: - Constants

    /// Fetches piece/ability/board-size definitions live from constants.js —
    /// used to drive the setup screen without hand-transcribing them into Swift.
    func loadConstants() async throws -> GameConstants {
        let resultJSON = try await host.call("ios_getConstants")
        return try decode(GameConstants.self, from: resultJSON)
    }

    /// Contextual sprite keys (cat_heart/cat_scared/robot_angry/robot_heart/...)
    /// for every revealed cell, computed by board.js's pure sprite-selection
    /// helpers in one batched call. `nil` entries are empty or covered cells.
    func spriteKeys() async throws -> [[String?]] {
        let resultJSON = try await host.call("ios_getAllSpriteKeys")
        return try decode([[String?]].self, from: resultJSON)
    }

    // MARK: - Lifecycle

    func startLocalGame(_ config: GameSetupConfig) async throws -> GameSnapshot {
        self.config = config
        let payload = try encode(StartGamePayload(numPlayers: config.numPlayers, enabledAbilities: config.enabledAbilities))
        let resultJSON = try await host.call("ios_startLocalGame", args: [payload])
        let snapshot = try decode(GameSnapshot.self, from: resultJSON)
        currentSnapshot = snapshot
        snapshotContinuation.yield(snapshot)
        return snapshot
    }

    func createOnlineGame(_ config: GameSetupConfig) async throws -> (gameId: String, playerNumber: Int?) {
        throw GameEngineError.notConnected
    }

    func joinOnlineGame(code: String) async throws -> (gameId: String, playerNumber: Int) {
        throw GameEngineError.notConnected
    }

    func rejoin() async throws -> GameSnapshot? { nil }

    // MARK: - Moves

    func availableDestinations(row: Int, col: Int) async -> [GameMove] {
        guard let snapshot = currentSnapshot, snapshot.board[row][col] != nil else { return [] }

        if snapshot.covered[row][col] {
            return [GameMove(type: "uncover", r: row, c: col)]
        }

        do {
            var result: [GameMove] = []

            let destinationsJSON = try await host.call("ios_getValidMoves", args: [String(row), String(col)])
            let destinations = try decode([BoardCell].self, from: destinationsJSON)
            for destination in destinations {
                let occupied = snapshot.board[destination.row][destination.col] != nil
                result.append(GameMove(
                    type: occupied ? "capture" : "move",
                    fromR: row, fromC: col, toR: destination.row, toC: destination.col
                ))
            }

            for function in [
                "ios_getPushMoves", "ios_getHopMoves", "ios_getEngulfMoves",
                "ios_getTransformMoves", "ios_getSnipeMoves", "ios_getPyroMoves",
            ] {
                let json = try await host.call(function, args: [String(row), String(col)])
                result += try decode([GameMove].self, from: json)
            }
            return result
        } catch {
            return []
        }
    }

    func submitMove(_ move: GameMove) async throws {
        let payload = try encode(move)
        let resultJSON = try await host.call("ios_applyMove", args: [payload])
        let snapshot = try decode(GameSnapshot.self, from: resultJSON)
        currentSnapshot = snapshot
        snapshotContinuation.yield(snapshot)
        if snapshot.gameOver {
            eventContinuation.yield(.gameOver(winner: snapshot.winner, reason: nil))
        }
    }

    /// Not part of GameEngineClient — local-only. The view model calls this when
    /// `config.players[currentPlayer].type == "cpu"`, after showing a "thinking"
    /// state, applying `cpuMoveDelayMs` pacing the same way js/no-modules/cpu.js's
    /// scheduleNextCpuMoveIfNeeded does.
    func requestCpuMove(cpuPlayer: Int, difficulty: String) async throws {
        let resultJSON = try await host.call("ios_computeCpuMove", args: [String(cpuPlayer), difficulty])
        let response = try decode(CpuMoveResponse.self, from: resultJSON)
        if let error = response.error {
            throw GameEngineError.jsException(error)
        }
        guard let move = response.move else {
            throw GameEngineError.invalidResponse("CPU: no move available")
        }
        try await submitMove(move)
    }

    func resign() async throws {
        guard var snapshot = currentSnapshot else { return }
        snapshot.gameOver = true
        snapshot.winner = snapshot.numPlayers == 2 ? (snapshot.currentPlayer == 1 ? 2 : 1) : nil
        currentSnapshot = snapshot
        snapshotContinuation.yield(snapshot)
        eventContinuation.yield(.gameOver(winner: snapshot.winner, reason: "resigned"))
    }

    func leaveGame() async throws {
        // No server session to tear down for a local game.
    }

    func requestRematch() async throws {
        guard let config else { return }
        _ = try await startLocalGame(config)
    }

    #if DEBUG
    /// Test-only: loads an arbitrary board state directly (bypassing the
    /// random deal in `startLocalGame`) so `availableDestinations` can be
    /// exercised deterministically. See SkillegoTests/AbilityMoveTests.swift.
    func debugLoadState(board: [[Piece?]], covered: [[Bool]], pushBlocked: [BoardCell] = [], abilities: [String]) async throws {
        let payload = TestLoadStatePayload(
            rows: board.count, cols: board.first?.count ?? 0,
            board: board, covered: covered, pushBlocked: pushBlocked, abilities: abilities
        )
        _ = try await host.call("ios_test_loadState", args: [try encode(payload)])
        currentSnapshot = GameSnapshot(
            board: board, covered: covered, pushBlocked: pushBlocked,
            currentPlayer: 1, numPlayers: 2, eliminatedPlayers: [],
            enabledAbilities: abilities, gameOver: false, winner: nil
        )
    }
    #endif
}

// MARK: - Wire-format helpers (LocalEngine-internal, not shared UI models)

private struct StartGamePayload: Codable {
    var numPlayers: Int
    var enabledAbilities: [String]
}

private struct CpuMoveResponse: Codable {
    var move: GameMove?
    var error: String?
}

#if DEBUG
private struct TestLoadStatePayload: Encodable {
    var rows: Int
    var cols: Int
    var board: [[Piece?]]
    var covered: [[Bool]]
    var pushBlocked: [BoardCell]
    var abilities: [String]
}
#endif

private func encode(_ value: some Encodable) throws -> String {
    let data = try JSONEncoder().encode(value)
    guard let string = String(data: data, encoding: .utf8) else {
        throw GameEngineError.invalidResponse("failed to encode payload as UTF-8 JSON")
    }
    return string
}

private func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
    guard let data = json.data(using: .utf8) else {
        throw GameEngineError.invalidResponse("response was not valid UTF-8: \(json)")
    }
    return try JSONDecoder().decode(T.self, from: data)
}
