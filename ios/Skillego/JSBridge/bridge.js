// bridge.js — iOS-only glue between the native app and the reused web engine
// files (constants.js, state.js, rules.js, ai-learning.js, minimax.js,
// classic-ai.js, gamelog.js, board.js). Loaded last, after all of those.
//
// If a function signature changes in js/no-modules/{rules,constants,minimax,
// classic-ai,board}.js, update this file and re-run SkillegoTests/JSEngineTests
// before merging.

// Used by classic-ai.js/minimax.js for tracing; the web app's version writes
// to a debug console the native app doesn't have.
function debugLog() {}

// Mirrors js/no-modules/cpu.js's CPU_DIFFICULTY_PARAMS — that file is DOM-coupled
// (drives a Web Worker + UI) and isn't part of this bundle, so this table is
// copied here. The project already tolerates the same duplication between the
// client and server/lib/constants.js.
const CPU_DIFFICULTY_PARAMS = {
    easy:   { depth: 1,    noise: 35 },
    medium: { depth: 2,    noise: 15 },
    hard:   { depth: null, noise: 0  },
    expert: { engine: 'classic' },
};

function ios_getConstants() {
    return JSON.stringify({
        boardConfig:    BOARD_CONFIG,
        pieces:         PIECES,
        burnLevel:      BURN_LEVEL,
        pieceAbilities: PIECE_ABILITIES,
        allAbilities:   ALL_ABILITIES,
        playerColors:   PLAYER_COLORS,
    });
}

function _snapshot() {
    return {
        board:             gameState.board,
        covered:           gameState.covered,
        pushBlocked:       gameState.pushBlocked ? [...gameState.pushBlocked] : [],
        currentPlayer:     gameState.currentPlayer,
        numPlayers:        gameState.numPlayers,
        eliminatedPlayers: [...gameState.eliminatedPlayers],
        enabledAbilities:  [...gameState.enabledAbilities],
        gameOver:          gameState.gameOver,
        winner:            gameState.winner || null,
    };
}

// Pure half of board.js's initializeBoard()+assignPieces() — same shuffle/deal
// algorithm, none of the DOM setup those functions also do.
function ios_startLocalGame(configJSON) {
    const cfg  = JSON.parse(configJSON);
    const dims = BOARD_CONFIG[cfg.numPlayers] || BOARD_CONFIG[2];
    BOARD_ROWS = dims.rows;
    BOARD_COLS = dims.cols;

    gameState.numPlayers        = cfg.numPlayers;
    gameState.enabledAbilities  = new Set(cfg.enabledAbilities || []);
    gameState.currentPlayer     = 1;
    gameState.eliminatedPlayers = new Set();
    gameState.gameOver          = false;
    gameState.winner            = null;
    gameState.pushBlocked       = [];
    gameState._pendingPushBlock = null;
    gameState.cpuLastMoveFrom   = null;
    gameState.cpuLastMoveTo     = null;
    gameState.cpuRecentSquares  = {};

    gameState.board   = Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(null));
    gameState.covered = Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(true));

    const allPieces = [];
    for (let player = 1; player <= gameState.numPlayers; player++) {
        PIECES.forEach(piece => {
            for (let i = 0; i < piece.quantity; i++) {
                allPieces.push({ ...piece, player });
            }
        });
    }
    allPieces.sort(() => Math.random() - 0.5);

    let index = 0;
    for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
            if (index < allPieces.length) gameState.board[row][col] = allPieces[index++];
        }
    }

    return JSON.stringify(_snapshot());
}

// r/c arrive as strings — every call from Swift goes through JSContextHost.call's
// [String] args (see its doc comment); rules.js does raw arithmetic on them
// (e.g. `r + dr`), which silently string-concatenates instead of adding unless
// coerced to numbers first.
function ios_getValidMoves(r, c)     { r = Number(r); c = Number(c); return JSON.stringify(getValidMoves(gameState, r, c)); }
function ios_getPushMoves(r, c)      { r = Number(r); c = Number(c); return JSON.stringify(getPushMoves(gameState, r, c, gameState.enabledAbilities)); }
function ios_getHopMoves(r, c)       { r = Number(r); c = Number(c); return JSON.stringify(getHopMoves(gameState, r, c, gameState.enabledAbilities)); }
function ios_getEngulfMoves(r, c)    { r = Number(r); c = Number(c); return JSON.stringify(getEngulfMoves(gameState, r, c, gameState.enabledAbilities)); }
function ios_getTransformMoves(r, c) { r = Number(r); c = Number(c); return JSON.stringify(getTransformMoves(gameState, r, c, gameState.enabledAbilities)); }
function ios_getSnipeMoves(r, c)     { r = Number(r); c = Number(c); return JSON.stringify(getSnipeMoves(gameState, r, c, gameState.enabledAbilities)); }
function ios_getPyroMoves(r, c)      { r = Number(r); c = Number(c); return JSON.stringify(getPyroMoves(gameState, r, c, gameState.enabledAbilities)); }

// board.js's contextual sprite key (cat_heart/cat_scared/robot_angry/robot_heart) —
// 100% DOM-free already; reused verbatim rather than hand-porting the mood rules.
function ios_pieceSpriteKey(r, c) {
    r = Number(r); c = Number(c);
    const piece = gameState.board[r][c];
    return piece ? _pieceSpriteKey(piece, r, c) : null;
}

// Batched form of the above for the whole board — one JSContext round-trip per
// snapshot instead of one per revealed cell per render (BoardView calls this
// once whenever the engine yields a new snapshot).
function ios_getAllSpriteKeys() {
    const result = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
        const row = [];
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = gameState.board[r][c];
            row.push(piece && !gameState.covered[r][c] ? _pieceSpriteKey(piece, r, c) : null);
        }
        result.push(row);
    }
    return JSON.stringify(result);
}

// Mirrors server/GameRoom.js's _endTurn/_checkGameOver, applied to gameState
// instead of a GameRoom instance.
function _checkGameOver() {
    const counts = {};
    for (let p = 1; p <= gameState.numPlayers; p++) counts[p] = 0;
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = gameState.board[r][c];
            if (p && p.player > 0) counts[p.player]++;
        }
    }
    for (let p = 1; p <= gameState.numPlayers; p++) {
        if (counts[p] === 0 && !gameState.eliminatedPlayers.has(p)) {
            gameState.eliminatedPlayers.add(p);
        }
    }
    const survivors = Array.from({ length: gameState.numPlayers }, (_, i) => i + 1)
        .filter(p => !gameState.eliminatedPlayers.has(p));
    if (survivors.length === 1) {
        gameState.gameOver = true;
        gameState.winner   = survivors[0];
    } else if (survivors.length === 0) {
        gameState.gameOver = true;
        gameState.winner   = null;
    }
}

function _endTurn() {
    gameState.pushBlocked = gameState._pendingPushBlock ? [gameState._pendingPushBlock] : [];
    gameState._pendingPushBlock = null;

    let next = (gameState.currentPlayer % gameState.numPlayers) + 1;
    let safety = 0;
    while (gameState.eliminatedPlayers.has(next) && safety++ < gameState.numPlayers) {
        next = (next % gameState.numPlayers) + 1;
    }
    gameState.currentPlayer = next;
}

// Applies a move already validated by the caller (the destinations returned by
// ios_get*Moves above) — same trust level as game.js's local click handling.
function ios_applyMove(moveJSON) {
    const move = JSON.parse(moveJSON);
    const state = { board: gameState.board, covered: gameState.covered, pushBlocked: gameState.pushBlocked };
    const next  = applyMoveToState(state, move);

    gameState.board   = next.board;
    gameState.covered = next.covered;
    gameState._pendingPushBlock = next.pushBlocked.length ? next.pushBlocked[0] : null;

    if (move.type === 'move' || move.type === 'capture') {
        gameState.cpuLastMoveFrom = { row: move.fromR, col: move.fromC };
        gameState.cpuLastMoveTo   = { row: move.toR,   col: move.toC   };
        const piece = gameState.board[move.toR][move.toC];
        if (piece) {
            const key = piece.type;
            gameState.cpuRecentSquares[key] = [
                { row: move.toR, col: move.toC },
                ...(gameState.cpuRecentSquares[key] || []),
            ].slice(0, 6);
        }
    }

    _checkGameOver();
    if (!gameState.gameOver) _endTurn();

    return JSON.stringify(_snapshot());
}

// Masked view of the board for the AI — covered pieces hidden, matching what a
// human player would see. Mirrors js/no-modules/cpu.js's captureCurrentState().
function _maskedStateFor(cpuPlayer) {
    const board = [];
    const covered = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
        board.push(new Array(BOARD_COLS));
        covered.push(new Array(BOARD_COLS));
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = gameState.board[r][c];
            covered[r][c] = gameState.covered[r][c];
            if (!p) {
                board[r][c] = null;
            } else if (gameState.covered[r][c]) {
                board[r][c] = { type: 'unknown', power: 0, player: 0 };
            } else {
                board[r][c] = { type: p.type, power: p.power, player: p.player, burning: p.burning || false };
            }
        }
    }
    return { board, covered, pushBlocked: gameState.pushBlocked ? [...gameState.pushBlocked] : [] };
}

function ios_computeCpuMove(cpuPlayer, difficulty) {
    cpuPlayer = Number(cpuPlayer);
    const params = CPU_DIFFICULTY_PARAMS[difficulty] || CPU_DIFFICULTY_PARAMS.hard;
    const state  = _maskedStateFor(cpuPlayer);
    const enabledAbilities = gameState.enabledAbilities;

    let move = null, error = null;
    try {
        if (params.engine === 'classic') {
            move = ClassicAI.getBestMove({ state, cpuPlayer, enabledAbilities });
        } else {
            move = SkillMinimax.getBestMove({
                state, cpuPlayer, enabledAbilities,
                cpuRecentSquares: gameState.cpuRecentSquares,
                cpuLastMoveFrom:  gameState.cpuLastMoveFrom,
                cpuLastMoveTo:    gameState.cpuLastMoveTo,
                depth:            params.depth,
                noise:            params.noise,
            });
        }
    } catch (e) {
        error = e.message;
    }
    return JSON.stringify({ move, error });
}

// ─── Test-only helpers (SkillegoTests/JSEngineTests.swift) ─────────────────
// Let the test target replay scripts/gen-ios-fixtures.js's fixtures — generated
// by running the same rules.js file through Node's `vm` module — through this
// exact bundled context, calling the pure functions directly rather than the
// gameState-mutating ios_* wrappers above (which also advance turns/check for
// game over, logic those fixtures don't exercise).
function ios_test_loadState(stateJSON) {
    const s = JSON.parse(stateJSON);
    BOARD_ROWS = s.rows;
    BOARD_COLS = s.cols;
    gameState.board = s.board;
    gameState.covered = s.covered;
    gameState.pushBlocked = s.pushBlocked || [];
    gameState.enabledAbilities = new Set(s.abilities || []);
    return 'ok';
}

function ios_test_applyMoveToState(moveJSON) {
    const state = { board: gameState.board, covered: gameState.covered, pushBlocked: gameState.pushBlocked };
    return JSON.stringify(applyMoveToState(state, JSON.parse(moveJSON)));
}
