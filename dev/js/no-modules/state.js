// state.js - Game state management

// Game state object
const gameState = {
    board: [],
    currentPlayer: 1,
    selectedCell: null,
    validMoves: [],
    playerColors: PLAYER_COLORS,
    // Per-player config (source of truth for setup screen)
    player1: { type: 'human', difficulty: 'expert' },
    player2: { type: 'cpu',   difficulty: 'expert' },
    // Derived at game start from player configs — used by cpu.js
    cpuEnabled: false,
    cpuDifficulty: 'expert',
    cpuPlayer: 2,
    cpuVsCpu: false,
    cpuMoveDelay: 800,
    covered: [],  // 6x6 bool — single source of truth for covered state (DOM mirrors this)
    gameOver: false,
    cpuLastMoveFrom: null,        // { row, col } — where the CPU moved FROM last turn (to detect oscillation)
    cpuLastMoveTo: null,          // { row, col } — where the CPU moved TO last turn
    cpuRecentSquares: {},         // per-piece-type history of recent destination squares, for oscillation detection
    enabledAbilities: new Set(['push', 'hop', 'transform']),
    numPlayers: 2,
    player3: { type: 'cpu', difficulty: 'expert' },
    player4: { type: 'cpu', difficulty: 'expert' },
    eliminatedPlayers: new Set(),
    animationsEnabled: true,
    // Optional per-player display names: { 1: 'Alice', 2: 'Bob', 3: 'Charlie', 4: 'Dave' }.
    // Populated by tournament-client (match start / spectate) and lobby-client
    // (game start). null in local play. _computeTurnLabel reads this so any
    // multiplayer path that knows real names gets a single consolidated path
    // for showing them in the turn indicator.
    playerNames: null,
    pushBlocked: [],        // active blocked squares [{row,col}] — checked by move validation
    _pendingPushBlock: null, // set by executePush, promoted to pushBlocked in endTurn
};
