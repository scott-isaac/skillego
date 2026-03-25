// state.js - Game state management

// Game state object
const gameState = {
    board: [],
    currentPlayer: 1,
    selectedCell: null,
    validMoves: [],
    validPushes: [],
    armedSpell: null,   // currently armed spell id, e.g. 'push'
    spellTargets: [],   // valid targets for the armed spell
    playerColors: PLAYER_COLORS,
    // Per-player config (source of truth for setup screen)
    player1: { type: 'human', difficulty: 'hard' },
    player2: { type: 'cpu',   difficulty: 'hard' },
    // Derived at game start from player configs — used by cpu.js
    cpuEnabled: false,
    cpuDifficulty: 'hard',
    cpuPlayer: 2,
    cpuVsCpu: false,
    cpuMoveDelay: 800,
    covered: [],  // 6x6 bool — single source of truth for covered state (DOM mirrors this)
    gameOver: false,
    cpuLastMoveFrom: null,        // { row, col } — where the CPU moved FROM last turn (to detect oscillation)
    cpuLastMoveTo: null,          // { row, col } — where the CPU moved TO last turn
    cpuRecentSquares: {},         // per-piece-type history of recent destination squares, for oscillation detection
    cpuJustUncoveredHighValue: null // { row, col } — position of eagle/dragon just uncovered, cleared after it moves
};
