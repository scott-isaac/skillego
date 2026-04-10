// cpu.js - CPU scheduling and move execution

// Schedule the next CPU move if the current player is a CPU.
function scheduleNextCpuMoveIfNeeded() {
    if (gameState.gameOver) return;
    if (gameState.eliminatedPlayers && gameState.eliminatedPlayers.has(gameState.currentPlayer)) {
        // Skip eliminated players automatically
        setTimeout(() => { if (!gameState.gameOver) endTurn(); }, 50);
        return;
    }
    const cfg = gameState[`player${gameState.currentPlayer}`];
    if (cfg && cfg.type === 'cpu') {
        setTimeout(makeCpuMove, gameState.cpuMoveDelay);
    }
}

// Build a masked view of the board for the AI — covered pieces are hidden,
// matching what a human player would see. This is the client-side boundary:
// on a server this step is unnecessary because the server never sends hidden data.
function captureCurrentState() {
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
    return { board, covered };
}

// Minimax search parameters per difficulty.
// depth=null lets minimax auto-scale depth by game phase (expert behaviour).
// noise adds ±jitter to move scores so lower difficulties make human-like mistakes.
// Minimax search parameters per difficulty.
// Easy/Medium: minimax with noise for human-like mistakes.
// Hard: minimax adaptive depth, no noise.
// Expert: deep negamax with iterative deepening + full ability support.
const CPU_DIFFICULTY_PARAMS = {
    easy:   { depth: 1, noise: 35 },
    medium: { depth: 2, noise: 15 },
    hard:   { depth: null, noise: 0 },
    expert: { engine: 'classic' },
};

function makeCpuMove() {
    debugLog("CPU is thinking...");
    if (gameState.gameOver) return;
    if (gameState.eliminatedPlayers && gameState.eliminatedPlayers.has(gameState.currentPlayer)) {
        endTurn(); return;
    }

    const cfg = gameState[`player${gameState.currentPlayer}`];
    if (!cfg || cfg.type !== 'cpu') {
        debugLog("CPU move cancelled: not CPU's turn"); return;
    }

    // In 4-player, cpuPlayer is always the current player
    const cpuPlayer = gameState.currentPlayer;
    const difficulty = cfg.difficulty || 'expert';

    const params = CPU_DIFFICULTY_PARAMS[difficulty] || CPU_DIFFICULTY_PARAMS.hard;
    const state  = captureCurrentState();

    let move;
    try {
        if (params.engine === 'classic') {
            move = ClassicAI.getBestMove({
                state,
                cpuPlayer,
                enabledAbilities: gameState.enabledAbilities,
            });
        } else {
            move = SkillMinimax.getBestMove({
                state,
                cpuPlayer,
                cpuRecentSquares: gameState.cpuRecentSquares,
                cpuLastMoveFrom:  gameState.cpuLastMoveFrom,
                cpuLastMoveTo:    gameState.cpuLastMoveTo,
                enabledAbilities: gameState.enabledAbilities,
                depth:            params.depth,
                noise:            params.noise,
            });
        }
    } catch (e) {
        console.error('CPU error:', e);
        debugLog('CPU error: ' + e.message);
        return;
    }

    if (!move) { debugLog('CPU: no move available'); return; }
    debugLog(`CPU P${cpuPlayer} (${difficulty}): ${move.type}`);

    // Track oscillation history for non-uncover moves
    if (move.type !== 'uncover') {
        const fromR = move.fromR ?? move.drR ?? move.robotR;
        const fromC = move.fromC ?? move.drC ?? move.robotC;
        const toR   = move.toR ?? move.destR ?? move.targetR;
        const toC   = move.toC ?? move.destC ?? move.targetC;
        if (fromR !== undefined) {
            gameState.cpuLastMoveFrom = { row: fromR, col: fromC };
            gameState.cpuLastMoveTo   = { row: toR,   col: toC   };
            const piece = gameState.board[fromR][fromC];
            if (piece) {
                if (!gameState.cpuRecentSquares) gameState.cpuRecentSquares = {};
                const histKey = piece.type;
                gameState.cpuRecentSquares[histKey] = [
                    { row: toR, col: toC },
                    ...(gameState.cpuRecentSquares[histKey] || [])
                ].slice(0, 6);
            }
        }
    }

    // Execute through the shared game engine functions
    if (move.type === 'uncover') {
        executeUncover(move.r, move.c);
    } else if (move.type === 'move' || move.type === 'capture') {
        movePiece(move.fromR, move.fromC, move.toR, move.toC);
        endTurn();
    } else if (move.type === 'push') {
        executePush(move.drR, move.drC, move.enemyR, move.enemyC, move.destR, move.destC);
    } else if (move.type === 'hop') {
        executeHop(move.fromR, move.fromC, move.toR, move.toC);
    } else if (move.type === 'engulf') {
        executeEngulf(move.r, move.c);
    } else if (move.type === 'snipe') {
        executeRobotKitty(move.robotR, move.robotC, move.targetR, move.targetC);
    } else if (move.type === 'pyro') {
        executePyromania(move.fromR, move.fromC, move.targetR, move.targetC);
    } else if (move.type === 'transform') {
        const cells = move.cells.map(({ r, c }) => ({ row: r, col: c }));
        executeTransform(move.wizR, move.wizC, cells, move.isExplosion);
    } else {
        debugLog(`CPU: unknown move type '${move.type}'`);
    }
}

