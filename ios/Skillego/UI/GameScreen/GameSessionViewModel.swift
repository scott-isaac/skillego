import Foundation
import Observation

enum DestinationKind {
    case move
    case capture
}

/// Turn/selection state machine mirroring js/no-modules/game.js's
/// handleCellClick exactly: tapping a covered piece uncovers it immediately;
/// tapping an own uncovered piece selects it and shows plain move/capture
/// destinations (from rules.js's getValidMoves) as tappable cells, plus any
/// ability moves (push/hop/engulf/transform/snipe/pyro) as skill-tray buttons;
/// tapping any cell while something is selected always clears the selection,
/// submitting the move only if the tapped cell was a valid destination.
@MainActor
@Observable
final class GameSessionViewModel {
    let config: GameSetupConfig
    private let engine: LocalEngine

    private(set) var snapshot: GameSnapshot?
    private(set) var selectedCell: BoardCell?
    private(set) var plainDestinations: [GameMove] = []
    private(set) var abilityMoves: [GameMove] = []
    private(set) var isCpuThinking = false
    private(set) var tileIndices: [[Int]] = []
    private(set) var spriteKeys: [[String?]] = []
    private(set) var lastMoveCells: [BoardCell] = []
    var errorMessage: String?

    private var snapshotObserver: Task<Void, Never>?
    private var eventObserver: Task<Void, Never>?

    init(config: GameSetupConfig, engine: LocalEngine) {
        self.config = config
        self.engine = engine
        observeSnapshots()
        observeEvents()
    }

    /// Must be called when this view model is no longer the active game screen
    /// (GameScreenView does this from `.onDisappear`). `engine` is a single,
    /// app-lifetime instance shared across games — its `snapshots`/`events`
    /// streams have a single producer, so a stale observer left running after
    /// navigating away would compete with the next game's view model for
    /// delivery. Deliberately not a `deinit` — actor-isolated stored properties
    /// can't be touched from `deinit`'s nonisolated context, and relying on ARC
    /// timing for a correctness-load-bearing stream handoff would be fragile.
    func stopObserving() {
        snapshotObserver?.cancel()
        eventObserver?.cancel()
    }

    func start() async {
        do {
            _ = try await engine.startLocalGame(config)
        } catch {
            errorMessage = "Couldn't start game: \(error)"
        }
    }

    // MARK: - Board interaction

    func tapCell(row: Int, col: Int) {
        guard let snapshot, !snapshot.gameOver, isCurrentPlayerControllable(snapshot) else { return }

        if selectedCell != nil {
            let move = plainDestinations.first { $0.toR == row && $0.toC == col }
            clearSelection()
            if let move {
                lastMoveCells = move.lastMoveCells
                Task { try? await engine.submitMove(move) }
            }
            return
        }

        guard let piece = snapshot.board[row][col] else { return }
        if snapshot.covered[row][col] {
            let move = GameMove(type: "uncover", r: row, c: col)
            lastMoveCells = move.lastMoveCells
            Task { try? await engine.submitMove(move) }
            return
        }
        guard piece.player == snapshot.currentPlayer else { return }

        let target = BoardCell(row: row, col: col)
        selectedCell = target
        Task {
            let moves = await engine.availableDestinations(row: row, col: col)
            guard selectedCell == target else { return } // superseded by a newer selection/deselect
            plainDestinations = moves.filter { $0.type == "move" || $0.type == "capture" }
            abilityMoves = moves.filter { !["move", "capture"].contains($0.type) }
        }
    }

    func submitAbilityMove(_ move: GameMove) {
        clearSelection()
        lastMoveCells = move.lastMoveCells
        Task { try? await engine.submitMove(move) }
    }

    func resign() {
        Task { try? await engine.resign() }
    }

    func requestRematch() {
        clearSelection()
        lastMoveCells = []
        Task { try? await engine.requestRematch() }
    }

    func isSelected(row: Int, col: Int) -> Bool {
        selectedCell == BoardCell(row: row, col: col)
    }

    /// `.move` (empty square) vs `.capture` (enemy square) render as distinct
    /// visuals — a soft green dot vs. glowing orange corner brackets — since
    /// they're materially different actions, mirroring styles.css's separate
    /// .valid-move / .valid-capture treatments.
    func destinationKind(row: Int, col: Int) -> DestinationKind? {
        guard let move = plainDestinations.first(where: { $0.toR == row && $0.toC == col }) else { return nil }
        return move.type == "capture" ? .capture : .move
    }

    func isLastMove(row: Int, col: Int) -> Bool {
        lastMoveCells.contains(BoardCell(row: row, col: col))
    }

    private func clearSelection() {
        selectedCell = nil
        plainDestinations = []
        abilityMoves = []
    }

    private func isCurrentPlayerControllable(_ snapshot: GameSnapshot) -> Bool {
        config.players[snapshot.currentPlayer]?.type != "cpu"
    }

    // MARK: - Reactive engine observation

    private func observeSnapshots() {
        snapshotObserver = Task { [weak self] in
            guard let self else { return }
            for await snap in engine.snapshots {
                self.snapshot = snap
                self.clearSelection()
                self.ensureTileIndices(rows: snap.board.count, cols: snap.board.first?.count ?? 0)
                self.spriteKeys = (try? await engine.spriteKeys()) ?? self.spriteKeys
                await self.triggerCpuIfNeeded(snap)
            }
        }
    }

    private func observeEvents() {
        eventObserver = Task { [weak self] in
            guard let self else { return }
            for await event in engine.events {
                if case .error(let message) = event {
                    self.errorMessage = message
                }
            }
        }
    }

    private func ensureTileIndices(rows: Int, cols: Int) {
        guard tileIndices.count != rows || tileIndices.first?.count != cols else { return }
        tileIndices = (0..<rows).map { _ in (0..<cols).map { _ in Int.random(in: 1...3) } }
    }

    private func triggerCpuIfNeeded(_ snapshot: GameSnapshot) async {
        guard !snapshot.gameOver else { return }
        guard let cfg = config.players[snapshot.currentPlayer], cfg.type == "cpu" else { return }
        isCpuThinking = true
        defer { isCpuThinking = false }
        do {
            try await Task.sleep(nanoseconds: UInt64(max(config.cpuMoveDelayMs, 0)) * 1_000_000)
            let move = try await engine.requestCpuMove(cpuPlayer: snapshot.currentPlayer, difficulty: cfg.difficulty ?? "expert")
            lastMoveCells = move.lastMoveCells
        } catch {
            errorMessage = "CPU error: \(error)"
        }
    }
}
