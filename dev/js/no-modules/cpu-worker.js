// cpu-worker.js — Web Worker for CPU AI computation
// Runs AI search off the main thread so GIF animations don't freeze.

// Stub for debugLog (used by classic-ai and minimax)
function debugLog() {}

// Import the AI dependencies
importScripts('constants.js', 'rules.js', 'minimax.js', 'classic-ai.js');

onmessage = function (e) {
    const { engine, params, state, cpuPlayer } = e.data;
    const enabledAbilities = new Set(e.data.enabledAbilities);

    // Board dimensions may differ per game mode
    if (e.data.boardRows) BOARD_ROWS = e.data.boardRows;
    if (e.data.boardCols) BOARD_COLS = e.data.boardCols;

    // SkillMinimax peeks at gameState.numPlayers — shim it
    if (typeof gameState === 'undefined') {
        self.gameState = {};
    }
    gameState.numPlayers = e.data.numPlayers || 2;

    let move = null;
    try {
        if (engine === 'classic') {
            move = ClassicAI.getBestMove({ state, cpuPlayer, enabledAbilities });
        } else {
            move = SkillMinimax.getBestMove({
                state, cpuPlayer, enabledAbilities,
                cpuRecentSquares: params.cpuRecentSquares,
                cpuLastMoveFrom:  params.cpuLastMoveFrom,
                cpuLastMoveTo:    params.cpuLastMoveTo,
                depth:            params.depth,
                noise:            params.noise,
            });
        }
    } catch (err) {
        postMessage({ error: err.message });
        return;
    }

    postMessage({ move });
};
