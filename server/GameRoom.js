'use strict';

const { BOARD_CONFIG, PIECES, BURN_LEVEL, CPU_DIFFICULTY_PARAMS } = require('./lib/constants');
const { createRules }    = require('./lib/rules');
const { createMinimax }  = require('./lib/minimax');

// ─── Move identity comparison ─────────────────────────────────────────────────
// Used to validate that a submitted move matches a legal move from the engine.
function movesMatch(a, b) {
    if (a.type !== b.type) return false;
    switch (a.type) {
        case 'uncover':  return a.r === b.r && a.c === b.c;
        case 'move':
        case 'capture':  return a.fromR === b.fromR && a.fromC === b.fromC && a.toR === b.toR && a.toC === b.toC;
        case 'push':     return a.drR === b.drR && a.drC === b.drC && a.destR === b.destR && a.destC === b.destC;
        case 'hop':      return a.fromR === b.fromR && a.fromC === b.fromC && a.toR === b.toR && a.toC === b.toC;
        case 'engulf':   return a.r === b.r && a.c === b.c;
        case 'snipe':    return a.robotR === b.robotR && a.robotC === b.robotC && a.targetR === b.targetR && a.targetC === b.targetC;
        case 'pyro':     return a.fromR === b.fromR && a.fromC === b.fromC && a.targetR === b.targetR && a.targetC === b.targetC;
        case 'transform':
            if (a.wizR !== b.wizR || a.wizC !== b.wizC || a.isExplosion !== b.isExplosion) return false;
            if (a.isExplosion) return true;
            // Line transform: match direction via second cell
            return a.cells[1]?.r === b.cells[1]?.r && a.cells[1]?.c === b.cells[1]?.c;
        default: return false;
    }
}

class GameRoom {
    constructor(gameId, numPlayers, playerConfigs, enabledAbilities) {
        this.gameId        = gameId;
        this.numPlayers    = numPlayers;
        this.playerConfigs = playerConfigs;  // { 1: {type, difficulty}, 2: ..., ... }
        this.enabledAbilities = new Set(enabledAbilities);

        const cfg    = BOARD_CONFIG[numPlayers] || BOARD_CONFIG[2];
        this.rows    = cfg.rows;
        this.cols    = cfg.cols;
        this.rules   = createRules({ rows: this.rows, cols: this.cols, burnLevel: BURN_LEVEL });
        this.minimax = createMinimax(this.rules);

        // players: Map of playerNumber → { socketId, token }
        this.players = new Map();

        this.board             = null;
        this.covered           = null;
        this.currentPlayer     = 1;
        this.eliminatedPlayers = new Set();
        this.gameOver          = false;
        this.winner            = null;

        // CPU oscillation tracking (shared across all CPU players in the room)
        this.cpuRecentSquares = {};
        this.cpuLastMoveFrom  = null;
        this.cpuLastMoveTo    = null;

        this.cpuMoveDelay = 800;

        this._initBoard();
    }

    // ─── Setup ────────────────────────────────────────────────────────────────
    _initBoard() {
        this.board   = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
        this.covered = Array.from({ length: this.rows }, () => Array(this.cols).fill(true));

        const allPieces = [];
        for (let player = 1; player <= this.numPlayers; player++) {
            for (const piece of PIECES) {
                for (let i = 0; i < piece.quantity; i++) {
                    allPieces.push({ type: piece.type, power: piece.power, player, burning: false });
                }
            }
        }
        allPieces.sort(() => Math.random() - 0.5);

        let idx = 0;
        for (let r = 0; r < this.rows && idx < allPieces.length; r++)
            for (let c = 0; c < this.cols && idx < allPieces.length; c++)
                this.board[r][c] = allPieces[idx++];
    }

    addPlayer(playerNumber, socketId, token) {
        this.players.set(playerNumber, { socketId, token });
    }

    // Returns the next human player slot that hasn't been filled yet.
    nextOpenSlot() {
        for (let p = 1; p <= this.numPlayers; p++) {
            if (this.playerConfigs[p]?.type === 'human' && !this.players.has(p)) return p;
        }
        return null;
    }

    // True when all human slots are filled (or there are no human players).
    readyToStart() {
        for (let p = 1; p <= this.numPlayers; p++) {
            if (this.playerConfigs[p]?.type === 'human' && !this.players.has(p)) return false;
        }
        return true;
    }

    getPlayerByToken(token) {
        for (const [p, info] of this.players) {
            if (info.token === token) return p;
        }
        return null;
    }

    // ─── State ────────────────────────────────────────────────────────────────
    // Returns the board with ALL covered pieces masked as unknown.
    // This is identical to what captureCurrentState() does client-side —
    // no player can ever read the identity of a covered piece from the wire.
    getMaskedState() {
        const board = [];
        for (let r = 0; r < this.rows; r++) {
            board.push([]);
            for (let c = 0; c < this.cols; c++) {
                const p = this.board[r][c];
                if (!p) {
                    board[r].push(null);
                } else if (this.covered[r][c]) {
                    board[r].push({ type: 'unknown', power: 0, player: 0 });
                } else {
                    board[r].push({ type: p.type, power: p.power, player: p.player, burning: p.burning });
                }
            }
        }
        return {
            board,
            covered:           this.covered.map(row => [...row]),
            currentPlayer:     this.currentPlayer,
            numPlayers:        this.numPlayers,
            eliminatedPlayers: [...this.eliminatedPlayers],
            enabledAbilities:  [...this.enabledAbilities],
            gameOver:          this.gameOver,
            winner:            this.winner,
        };
    }

    // ─── Move Validation & Application ────────────────────────────────────────
    // Returns { valid: true } or { valid: false, error: string }.
    applyMove(move, playerNumber) {
        if (this.gameOver)                              return { valid: false, error: 'Game is over' };
        if (playerNumber !== this.currentPlayer)        return { valid: false, error: 'Not your turn' };
        if (this.eliminatedPlayers.has(playerNumber))   return { valid: false, error: 'You have been eliminated' };

        const state = { board: this.board, covered: this.covered };
        const legalMoves = this._getAllMovesForPlayer(playerNumber);
        const legal = legalMoves.find(m => movesMatch(m, move));
        if (!legal) return { valid: false, error: 'Illegal move' };

        // Apply to the authoritative board using the validated legal move
        // (use `legal` not `move` so server-computed fields like capPower are correct)
        const newState = this.rules.applyMoveToState(state, legal);
        this.board   = newState.board;
        this.covered = newState.covered;

        // Track CPU oscillation data (used when computing the next CPU move)
        if (legal.type === 'move' || legal.type === 'capture') {
            this.cpuLastMoveFrom = { row: legal.fromR, col: legal.fromC };
            this.cpuLastMoveTo   = { row: legal.toR,   col: legal.toC   };
            const piece = this.board[legal.toR][legal.toC];
            if (piece) {
                const key = piece.type;
                this.cpuRecentSquares[key] = [
                    { row: legal.toR, col: legal.toC },
                    ...( this.cpuRecentSquares[key] || [] ),
                ].slice(0, 6);
            }
        }

        this._checkGameOver();
        if (!this.gameOver) this._endTurn();

        return { valid: true };
    }

    _getAllMovesForPlayer(playerNumber) {
        // Minimax's getAllMoves lives in the minimax factory, but we need it here
        // for validation. Re-implement the same logic using rules functions directly.
        const state    = { board: this.board, covered: this.covered };
        const captures = [], moves = [], uncovers = [];

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const piece = state.board[r][c];
                if (!piece) continue;

                if (state.covered[r][c]) {
                    uncovers.push({ type: 'uncover', r, c });
                } else if (piece.player === playerNumber) {
                    for (const { row, col } of this.rules.getValidMoves(state, r, c)) {
                        const target = state.board[row][col];
                        if (target) {
                            captures.push({ type: 'capture', fromR: r, fromC: c, toR: row, toC: col, capPower: target.power });
                        } else {
                            moves.push({ type: 'move', fromR: r, fromC: c, toR: row, toC: col });
                        }
                    }
                    for (const m of this.rules.getPushMoves(state, r, c, this.enabledAbilities))    moves.push(m);
                    for (const m of this.rules.getHopMoves(state, r, c, this.enabledAbilities))     moves.push(m);
                    for (const m of this.rules.getEngulfMoves(state, r, c, this.enabledAbilities))  moves.push(m);
                    for (const m of this.rules.getSnipeMoves(state, r, c, this.enabledAbilities))   captures.push(m);
                    for (const m of this.rules.getPyroMoves(state, r, c, this.enabledAbilities))    moves.push(m);
                    for (const m of this.rules.getTransformMoves(state, r, c, this.enabledAbilities)) moves.push(m);
                }
            }
        }

        captures.sort((a, b) => (b.capPower || 0) - (a.capPower || 0));
        return [...captures, ...moves, ...uncovers];
    }

    // ─── CPU ──────────────────────────────────────────────────────────────────
    currentPlayerIsCpu() {
        return this.playerConfigs[this.currentPlayer]?.type === 'cpu';
    }

    computeCpuMove() {
        const cfg    = this.playerConfigs[this.currentPlayer];
        const params = CPU_DIFFICULTY_PARAMS[cfg?.difficulty] || CPU_DIFFICULTY_PARAMS.hard;
        return this.minimax.getBestMove({
            state:            this.getMaskedState(),
            cpuPlayer:        this.currentPlayer,
            numPlayers:       this.numPlayers,
            cpuRecentSquares: this.cpuRecentSquares,
            cpuLastMoveFrom:  this.cpuLastMoveFrom,
            cpuLastMoveTo:    this.cpuLastMoveTo,
            enabledAbilities: this.enabledAbilities,
            depth:            params.depth,
            noise:            params.noise,
        });
    }

    // ─── Turn / Elimination ───────────────────────────────────────────────────
    _endTurn() {
        let next   = (this.currentPlayer % this.numPlayers) + 1;
        let safety = 0;
        while (this.eliminatedPlayers.has(next) && safety++ < this.numPlayers) {
            next = (next % this.numPlayers) + 1;
        }
        this.currentPlayer = next;
    }

    _checkGameOver() {
        const counts = {};
        for (let p = 1; p <= this.numPlayers; p++) counts[p] = 0;
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++) {
                const p = this.board[r][c];
                if (p && p.player > 0) counts[p.player]++;
            }

        for (let p = 1; p <= this.numPlayers; p++) {
            if (counts[p] === 0 && !this.eliminatedPlayers.has(p)) {
                this.eliminatedPlayers.add(p);
            }
        }

        const survivors = Array.from({ length: this.numPlayers }, (_, i) => i + 1)
            .filter(p => !this.eliminatedPlayers.has(p));

        if (survivors.length === 1) {
            this.gameOver = true;
            this.winner   = survivors[0];
        } else if (survivors.length === 0) {
            this.gameOver = true;
            this.winner   = null;
        }
    }
}

module.exports = GameRoom;
