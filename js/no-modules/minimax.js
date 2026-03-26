// minimax.js - Minimax AI with alpha-beta pruning for expert difficulty

const SkillMinimax = (function () {
    'use strict';

    // ─── State Representation ─────────────────────────────────────────────────
    // Captures the real game state but MASKS covered pieces — the AI does not
    // know what is under face-down cells, same as a human player.
    function captureCurrentState() {
        const board = [];
        const covered = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            board.push(new Array(BOARD_SIZE));
            covered.push(new Array(BOARD_SIZE));
            for (let c = 0; c < BOARD_SIZE; c++) {
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

    // ─── Move Generation ──────────────────────────────────────────────────────
    // Returns true if transform move places a mouse adjacent to an enemy dragon,
    // or if the enemy dragon is nearly the last piece and we have no mice.
    function transformIsWorthIt(state, move, player) {
        const opPlayer = player === 1 ? 2 : 1;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (!p || p.player !== opPlayer || p.type !== 'dragon' || state.covered[r][c]) continue;
                // Does any mouse cell land adjacent to the dragon?
                for (const { r: mr, c: mc } of move.cells) {
                    if (Math.abs(mr - r) + Math.abs(mc - c) === 1) return true;
                }
                // Fallback: dragon is one of very few remaining pieces and we have no mice
                let opCount = 0, ownMice = 0;
                for (let pr = 0; pr < BOARD_SIZE; pr++)
                    for (let pc = 0; pc < BOARD_SIZE; pc++) {
                        const pp = state.board[pr][pc];
                        if (!pp || pp.player === 0) continue;
                        if (pp.player === opPlayer) opCount++;
                        if (pp.player === player && pp.type === 'mouse' && !state.covered[pr][pc]) ownMice++;
                    }
                if (opCount <= 3 && ownMice === 0) return true;
            }
        }
        return false;
    }

    // All legal moves for a player: captures first, then moves/abilities, then uncovers.
    function getAllMoves(state, player) {
        const captures = [];
        const moves    = [];
        const uncovers = [];

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const piece = state.board[r][c];
                if (!piece) continue;

                if (state.covered[r][c]) {
                    uncovers.push({ type: 'uncover', r, c });
                } else if (piece.player === player) {
                    // Standard moves
                    for (const { row, col } of getValidMoves(state, r, c)) {
                        const target = state.board[row][col];
                        if (target) {
                            captures.push({ type: 'capture', fromR: r, fromC: c, toR: row, toC: col, capPower: target.power });
                        } else {
                            moves.push({ type: 'move', fromR: r, fromC: c, toR: row, toC: col });
                        }
                    }
                    // Ability moves
                    for (const m of getPushMoves(state, r, c))    moves.push(m);
                    for (const m of getHopMoves(state, r, c))     moves.push(m);
                    for (const m of getEngulfMoves(state, r, c))  moves.push(m);
                    for (const m of getSnipeMoves(state, r, c))   captures.push(m);  // snipe removes a piece
                    for (const m of getPyroMoves(state, r, c))    moves.push(m);
                    for (const m of getTransformMoves(state, r, c)) {
                        if (transformIsWorthIt(state, m, player)) moves.push(m);
                    }
                }
            }
        }

        captures.sort((a, b) => (b.capPower || 0) - (a.capPower || 0));
        return [...captures, ...moves, ...uncovers];
    }

    // ─── Apply Move ───────────────────────────────────────────────────────────
    function applyMove(state, move) {
        return applyMoveToState(state, move);
    }

    // ─── Evaluation ───────────────────────────────────────────────────────────
    function evaluate(state, cpuPlayer) {
        const opPlayer = cpuPlayer === 1 ? 2 : 1;
        let score = 0;
        let cpuDragon = null, opDragon = null;
        let cpuPieces = 0, opPieces = 0;

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (!p || p.player === 0) continue; // skip empty and covered (identity unknown)
                // Burning pieces are worth less — they will continue to degrade
                const val = p.power * (p.burning ? 7.5 : 10);
                if (p.player === cpuPlayer) {
                    score += val;
                    cpuPieces++;
                    if (p.type === 'dragon') cpuDragon = { r, c, burning: p.burning };
                } else {
                    score -= val;
                    opPieces++;
                    if (p.type === 'dragon') opDragon = { r, c, burning: p.burning };
                }
            }
        }

        // Crude terminal detection (all pieces known, one side wiped out)
        const hasCovered = state.covered.some(row => row.some(v => v));
        if (!hasCovered) {
            if (cpuPieces === 0) return -1000;
            if (opPieces  === 0) return  1000;
        }

        // Mobility
        let cpuMobility = 0, opMobility = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (!p || p.player === 0 || state.covered[r][c]) continue;
                const cnt = getValidMoves(state, r, c).length;
                if (p.player === cpuPlayer) cpuMobility += cnt;
                else opMobility += cnt;
            }
        }
        score += (cpuMobility - opMobility) * 0.5;

        // Dragon-mouse proximity threat (suppressed when dragon is burning — immune to mice)
        if (cpuDragon && !cpuDragon.burning) {
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player === opPlayer && !state.covered[r][c]) {
                        const d = Math.abs(r - cpuDragon.r) + Math.abs(c - cpuDragon.c);
                        if (d === 1) score -= 45;
                        else if (d === 2) score -= 18;
                        else if (d === 3) score -= 7;
                    }
                }
            }
        }
        if (opDragon && !opDragon.burning) {
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player === cpuPlayer && !state.covered[r][c]) {
                        const d = Math.abs(r - opDragon.r) + Math.abs(c - opDragon.c);
                        if (d === 1) score += 45;
                        else if (d === 2) score += 18;
                        else if (d === 3) score += 7;
                    }
                }
            }
        }

        // Attack pressure: adjacent capturable opponents
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (!p || p.player === 0 || state.covered[r][c]) continue;
                for (const [dr, dc] of DIRS) {
                    const nr = r + dr, nc = c + dc;
                    if (!inBounds(nr, nc)) continue;
                    const t = state.board[nr][nc];
                    if (!t || t.player === 0 || state.covered[nr][nc] || t.player === p.player) continue;
                    if (canCapture(p, t)) {
                        const bonus = t.power * 10;
                        if (p.player === cpuPlayer) score += bonus;
                        else score -= bonus;
                    }
                }
            }
        }

        // Endgame hunt
        if (opPieces === 1 && !hasCovered) {
            let lastR = -1, lastC = -1, lastPiece = null;
            outer: for (let r = 0; r < BOARD_SIZE; r++)
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const p = state.board[r][c];
                    if (p && p.player === opPlayer && !state.covered[r][c]) {
                        lastR = r; lastC = c; lastPiece = p; break outer;
                    }
                }
            if (lastR >= 0) {
                for (let r = 0; r < BOARD_SIZE; r++)
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        const p = state.board[r][c];
                        if (!p || p.player !== cpuPlayer || state.covered[r][c]) continue;
                        if (!canCapture(p, lastPiece)) continue;
                        const dist = Math.abs(r - lastR) + Math.abs(c - lastC);
                        score += Math.max(0, 8 - dist) * 12;
                    }
                score -= opMobility * 12;
            }
        }

        return score;
    }

    // ─── Minimax with Alpha-Beta Pruning ──────────────────────────────────────
    function minimax(state, depth, alpha, beta, isMaxPlayer, cpuPlayer) {
        if (!state.covered.some(row => row.some(v => v))) {
            let cpuCount = 0, opCount = 0;
            for (let r = 0; r < BOARD_SIZE; r++)
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const p = state.board[r][c];
                    if (!p || p.player === 0) continue;
                    p.player === cpuPlayer ? cpuCount++ : opCount++;
                }
            if (cpuCount === 0) return -1000 - depth;
            if (opCount  === 0) return  1000 + depth;
        }

        if (depth === 0) return evaluate(state, cpuPlayer);

        const currentPlayer = isMaxPlayer ? cpuPlayer : (cpuPlayer === 1 ? 2 : 1);
        const moves = getAllMoves(state, currentPlayer);

        if (moves.length === 0) return isMaxPlayer ? -900 : 900;

        const movesToSearch = moves.slice(0, 20);

        if (isMaxPlayer) {
            let best = -Infinity;
            for (const move of movesToSearch) {
                const val = minimax(applyMove(state, move), depth - 1, alpha, beta, false, cpuPlayer);
                if (val > best) best = val;
                if (val > alpha) alpha = val;
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (const move of movesToSearch) {
                const val = minimax(applyMove(state, move), depth - 1, alpha, beta, true, cpuPlayer);
                if (val < best) best = val;
                if (val < beta) beta = val;
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────
    function getBestMove() {
        const state = captureCurrentState();

        let coveredCount = 0;
        for (let r = 0; r < BOARD_SIZE; r++)
            for (let c = 0; c < BOARD_SIZE; c++)
                if (state.board[r][c] && state.covered[r][c]) coveredCount++;

        let opUncoveredCount = 0;
        for (let r = 0; r < BOARD_SIZE; r++)
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (p && p.player !== gameState.cpuPlayer && !state.covered[r][c]) opUncoveredCount++;
            }

        const isEndgameHunt = coveredCount === 0 && opUncoveredCount === 1;
        const depth = coveredCount > 16 ? 3 : coveredCount > 6 ? 4 : isEndgameHunt ? 7 : 5;
        debugLog(`Minimax: depth=${depth}, covered=${coveredCount}, opUncovered=${opUncoveredCount}`);

        const moves = getAllMoves(state, gameState.cpuPlayer);
        if (moves.length === 0) return null;

        const recentSquares = gameState.cpuRecentSquares || {};
        const lastFrom = gameState.cpuLastMoveFrom;
        const lastTo   = gameState.cpuLastMoveTo;

        const scoredMoves = [];
        let alpha = -Infinity;
        const beta = Infinity;

        for (const move of moves) {
            const newState = applyMove(state, move);
            let score = minimax(newState, depth - 1, alpha, beta, false, gameState.cpuPlayer);

            if (move.type !== 'uncover') {
                if (lastFrom && lastTo &&
                    move.fromR === lastTo.row   && move.fromC === lastTo.col &&
                    move.toR   === lastFrom.row  && move.toC  === lastFrom.col) {
                    score -= 15;
                }
                const fromR = move.fromR ?? move.drR ?? move.robotR;
                const fromC = move.fromC ?? move.drC ?? move.robotC;
                const piece = fromR !== undefined ? state.board[fromR][fromC] : null;
                if (piece) {
                    const history = recentSquares[piece.type] || [];
                    const toR = move.toR ?? move.destR ?? move.targetR;
                    const toC = move.toC ?? move.destC ?? move.targetC;
                    const visits = history.filter(s => s.row === toR && s.col === toC).length;
                    if (visits > 0) score -= visits * 8;
                }
            }

            scoredMoves.push({ move, score });
            if (score > alpha) alpha = score;
        }

        scoredMoves.sort((a, b) => b.score - a.score);
        const best = scoredMoves[0];
        debugLog(`Minimax chose: ${best.move.type} score=${best.score}`);
        return best.move;
    }

    return { getBestMove };
})();
