// minimax.js - Minimax AI with alpha-beta pruning for expert difficulty

const SkillMinimax = (function () {
    'use strict';

    // ─── Piece-set constants (lazily cached) ──────────────────────────────────
    // PIECES is a global defined before this file loads.
    let _startPower = null, _startCount = null;
    function startStats() {
        if (_startPower === null) {
            _startPower = PIECES.reduce((s, p) => s + p.quantity * p.power, 0);
            _startCount = PIECES.reduce((s, p) => s + p.quantity, 0);
        }
        return { power: _startPower, count: _startCount };
    }

    // ─── Move Generation ──────────────────────────────────────────────────────
    // Returns true if transform move places a mouse adjacent to an enemy dragon,
    // or if the enemy dragon is nearly the last piece and we have no mice.
    function transformIsWorthIt(state, move, player) {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p || p.player === player || p.player === 0 || p.type !== 'dragon' || state.covered[r][c]) continue;
                // Does any mouse cell land adjacent to the dragon?
                for (const { r: mr, c: mc } of move.cells) {
                    if (Math.abs(mr - r) + Math.abs(mc - c) === 1) return true;
                }
                // Fallback: dragon is one of very few remaining pieces and we have no mice
                let opCount = 0, ownMice = 0;
                for (let pr = 0; pr < BOARD_ROWS; pr++)
                    for (let pc = 0; pc < BOARD_COLS; pc++) {
                        const pp = state.board[pr][pc];
                        if (!pp || pp.player === 0) continue;
                        if (pp.player !== player && pp.player !== 0) opCount++;
                        if (pp.player === player && pp.type === 'mouse' && !state.covered[pr][pc]) ownMice++;
                    }
                if (opCount <= 3 && ownMice === 0) return true;
            }
        }
        return false;
    }

    // All legal moves for a player: captures first, then moves/abilities, then uncovers.
    function getAllMoves(state, player, enabledAbilities) {
        const captures = [];
        const moves    = [];
        const uncovers = [];

        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
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
                    for (const m of getPushMoves(state, r, c, enabledAbilities))    moves.push(m);
                    for (const m of getHopMoves(state, r, c, enabledAbilities))     moves.push(m);
                    for (const m of getEngulfMoves(state, r, c, enabledAbilities)) {
                        // Offer engulf when an enemy mouse is nearby (distance <= 2).
                        // Minimax will decide if it's tactically worth it vs other options.
                        let nearbyMouse = false;
                        for (let mr = 0; mr < BOARD_ROWS; mr++) {
                            for (let mc = 0; mc < BOARD_COLS; mc++) {
                                const t = state.board[mr][mc];
                                if (t && t.type === 'mouse' && t.player !== player && !state.covered[mr][mc]) {
                                    if (Math.abs(mr - r) + Math.abs(mc - c) <= 2) {
                                        nearbyMouse = true; break;
                                    }
                                }
                            }
                            if (nearbyMouse) break;
                        }
                        if (nearbyMouse) moves.push(m);
                    }
                    for (const m of getSnipeMoves(state, r, c, enabledAbilities))   captures.push(m);  // snipe removes a piece
                    for (const m of getPyroMoves(state, r, c, enabledAbilities))    moves.push(m);
                    for (const m of getTransformMoves(state, r, c, enabledAbilities)) {
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
        let score = 0;
        let cpuDragon = null, opDragon = null;
        let cpuPieces = 0, opPieces = 0;
        let cpuVisiblePower = 0, opVisiblePower = 0;
        let coveredCount = 0;

        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p) continue;
                if (p.player === 0) { coveredCount++; continue; } // covered — identity unknown
                // Burning pieces are worth less — they will continue to degrade
                const val = p.power * (p.burning ? 7.5 : 10);
                if (p.player === cpuPlayer) {
                    score += val;
                    cpuPieces++;
                    cpuVisiblePower += p.power;
                    if (p.type === 'dragon') cpuDragon = { r, c, burning: p.burning };
                } else {
                    score -= val;
                    opPieces++;
                    opVisiblePower += p.power;
                    if (p.type === 'dragon' && !opDragon) opDragon = { r, c, burning: p.burning };
                }
            }
        }

        // Expected material value of covered cells.
        // Each player's "unaccounted" power = starting power - visible power (covers both still-covered
        // and already-captured pieces). Scaling by coveredCount/totalRemainingCount discounts for the
        // fraction of unaccounted pieces that are actually on the board vs already gone.
        if (coveredCount > 0) {
            const { power: startPower, count: startCount } = startStats();
            const cpuUnaccounted = Math.max(0, startPower - cpuVisiblePower);
            const opUnaccounted  = Math.max(0, startPower - opVisiblePower);
            const totalRemaining = Math.max(1, (startCount - cpuPieces) + (startCount - opPieces));
            score += (cpuUnaccounted - opUnaccounted) * 10 * coveredCount / totalRemaining * 0.6;
        }

        // Crude terminal detection (all pieces known, one side wiped out)
        const hasCovered = coveredCount > 0;
        if (!hasCovered) {
            if (cpuPieces === 0) return -1000;
            if (opPieces  === 0) return  1000;
        }

        // Positional evaluation: mobility restriction + safe movement analysis.
        // A piece with few safe moves is effectively trapped — heavily penalize that.
        // "Safe move" = a square where no adjacent enemy can capture you.
        let cpuMobility = 0, opMobility = 0;
        let cpuTrapped = 0, opTrapped = 0;
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p || p.player === 0 || state.covered[r][c]) continue;
                const moves = getValidMoves(state, r, c);
                let safeMoves = 0;
                for (const { row: mr, col: mc } of moves) {
                    // A move is "safe" if no adjacent enemy at the destination can capture this piece
                    let safe = true;
                    for (const [dr, dc] of DIRS) {
                        const nr = mr + dr, nc = mc + dc;
                        if (!inBounds(nr, nc)) continue;
                        const adj = state.board[nr][nc];
                        if (adj && adj.player !== p.player && adj.player !== 0 && !state.covered[nr][nc]) {
                            if (canCapture(adj, p)) { safe = false; break; }
                        }
                    }
                    if (safe) safeMoves++;
                }
                if (p.player === cpuPlayer) {
                    cpuMobility += safeMoves;
                    if (safeMoves === 0) cpuTrapped++;
                } else {
                    opMobility += safeMoves;
                    if (safeMoves === 0) opTrapped++;
                }
            }
        }
        // Mobility difference: weight increases in late game
        const mobilityWeight = hasCovered ? 1.0 : 3.0;
        score += (cpuMobility - opMobility) * mobilityWeight;
        // Trapped pieces are severely penalized — they're effectively dead
        score += (opTrapped - cpuTrapped) * 15;

        // Dragon-mouse proximity threat (suppressed when dragon is burning — immune to mice)
        if (cpuDragon && !cpuDragon.burning) {
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player !== cpuPlayer && p.player !== 0 && !state.covered[r][c]) {
                        const d = Math.abs(r - cpuDragon.r) + Math.abs(c - cpuDragon.c);
                        if (d === 1) score -= 45;
                        else if (d === 2) score -= 18;
                        else if (d === 3) score -= 7;
                    }
                }
            }
        }
        if (opDragon && !opDragon.burning) {
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player === cpuPlayer && !state.covered[r][c]) {
                        const d = Math.abs(r - opDragon.r) + Math.abs(c - opDragon.c);
                        if (d === 1) score += 45;
                        else if (d === 2) score += 25;
                        else if (d === 3) score += 10;
                    }
                }
            }
        }

        // Attack pressure: adjacent capturable opponents
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
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

        // Piece safety: penalize high-value pieces in one-sided danger.
        // Only applies to pieces with power >= 3 that can't fight back.
        // Low-value pieces (mice, cats) are expendable — the search tree handles trades.
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p || p.player === 0 || state.covered[r][c] || p.power < 3) continue;
                for (const [dr, dc] of DIRS) {
                    const nr = r + dr, nc = c + dc;
                    if (!inBounds(nr, nc)) continue;
                    const t = state.board[nr][nc];
                    if (!t || t.player === 0 || state.covered[nr][nc] || t.player === p.player) continue;
                    if (canCapture(t, p) && !canCapture(p, t)) {
                        const penalty = p.power * 5;
                        if (p.player === cpuPlayer) score -= penalty;
                        else score += penalty;
                        break;
                    }
                }
            }
        }

        // Robot threat dynamics
        // Locate both robots (only uncovered ones are known)
        let cpuRobotPos = null, opRobotPos = null;
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p || state.covered[r][c]) continue;
                if (p.player === cpuPlayer && p.type === 'robot') cpuRobotPos = { r, c };
                else if (p.player !== cpuPlayer && p.player !== 0 && p.type === 'robot') opRobotPos = { r, c };
            }
        }
        const robotEngageScale = hasCovered ? 0.5 : 1.0;
        if (opRobotPos) {
            // CPU pieces near enemy robot are in danger — mirrors dragon-mouse proximity logic
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (!p || p.player !== cpuPlayer || state.covered[r][c] || p.type === 'robot') continue;
                    const dist = Math.abs(r - opRobotPos.r) + Math.abs(c - opRobotPos.c);
                    if (dist <= 4) score -= Math.max(0, 5 - dist) * p.power * 1.2 * robotEngageScale;
                }
            }
            // CPU robot should close on enemy robot to contest/corner it
            if (cpuRobotPos) {
                const rrDist = Math.abs(cpuRobotPos.r - opRobotPos.r) + Math.abs(cpuRobotPos.c - opRobotPos.c);
                score += Math.max(0, 7 - rrDist) * 6 * robotEngageScale;
            }
        }
        // CPU robot draws toward high-value enemy targets — prevents dormancy
        if (cpuRobotPos) {
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (!p || p.player === cpuPlayer || p.player === 0 || state.covered[r][c]) continue;
                    const dist = Math.abs(r - cpuRobotPos.r) + Math.abs(c - cpuRobotPos.c);
                    score += Math.max(0, 7 - dist) * p.power * 0.6 * robotEngageScale;
                }
            }
        }

        // Endgame pursuit — when few pieces remain and board is mostly uncovered,
        // reward positions that RESTRICT opponent movement rather than just chasing.
        // The goal is to corner opponents so their only moves are into our capture range.
        if (coveredCount <= 3 && opPieces <= 5) {
            // For each opponent piece, reward CPU pieces that can reach it
            // AND penalize opponent's total safe mobility (already in score above)
            for (let er = 0; er < BOARD_ROWS; er++) {
                for (let ec = 0; ec < BOARD_COLS; ec++) {
                    const t = state.board[er][ec];
                    if (!t || t.player === cpuPlayer || t.player === 0 || state.covered[er][ec]) continue;
                    // How many safe moves does this specific opponent piece have?
                    const eMoves = getValidMoves(state, er, ec);
                    let eSafeMoves = 0;
                    for (const { row: mr, col: mc } of eMoves) {
                        let safe = true;
                        for (const [dr, dc] of DIRS) {
                            const nr = mr + dr, nc = mc + dc;
                            if (!inBounds(nr, nc)) continue;
                            const adj = state.board[nr][nc];
                            if (adj && adj.player === cpuPlayer && !state.covered[nr][nc] && canCapture(adj, t)) {
                                safe = false; break;
                            }
                        }
                        if (safe) eSafeMoves++;
                    }
                    // Reward restricting this piece — fewer safe moves = better
                    const restrictionBonus = Math.max(0, 4 - eSafeMoves) * t.power * 3;
                    score += restrictionBonus;

                    // Also reward having a capturer nearby (but don't over-weight pure chasing)
                    for (let r = 0; r < BOARD_ROWS; r++) {
                        for (let c = 0; c < BOARD_COLS; c++) {
                            const p = state.board[r][c];
                            if (!p || p.player !== cpuPlayer || state.covered[r][c]) continue;
                            if (canCapture(p, t)) {
                                const dist = Math.abs(r - er) + Math.abs(c - ec);
                                score += Math.max(0, 8 - dist) * 2;
                            }
                        }
                    }
                }
            }
        }

        return score;
    }

    // ─── Minimax with Alpha-Beta Pruning ──────────────────────────────────────
    function minimax(state, depth, alpha, beta, isMaxPlayer, cpuPlayer, enabledAbilities) {
        if (!state.covered.some(row => row.some(v => v))) {
            let cpuCount = 0, opCount = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (!p || p.player === 0) continue;
                    p.player === cpuPlayer ? cpuCount++ : opCount++;
                }
            if (cpuCount === 0) return -1000 - depth;
            if (opCount  === 0) return  1000 + depth;
        }

        if (depth === 0) return evaluate(state, cpuPlayer);

        const numP = (typeof gameState !== 'undefined' && gameState.numPlayers) || 2;
        const currentPlayer = isMaxPlayer ? cpuPlayer : (cpuPlayer % numP) + 1;
        const moves = getAllMoves(state, currentPlayer, enabledAbilities);

        if (moves.length === 0) return isMaxPlayer ? -900 : 900;

        const movesToSearch = moves.slice(0, 20);

        if (isMaxPlayer) {
            let best = -Infinity;
            for (const move of movesToSearch) {
                const val = minimax(applyMove(state, move), depth - 1, alpha, beta, false, cpuPlayer, enabledAbilities);
                if (val > best) best = val;
                if (val > alpha) alpha = val;
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (const move of movesToSearch) {
                const val = minimax(applyMove(state, move), depth - 1, alpha, beta, true, cpuPlayer, enabledAbilities);
                if (val < best) best = val;
                if (val < beta) beta = val;
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────
    // state      — pre-built masked board (caller is responsible for masking covered pieces)
    // depth      — search depth override; null = auto-select by game phase (expert behaviour)
    // noise      — score jitter ±noise applied per move (simulates lower-difficulty mistakes)
    function getBestMove({ state, cpuPlayer, cpuRecentSquares, cpuLastMoveFrom, cpuLastMoveTo, enabledAbilities, depth, noise }) {
        const NUM_PLAYERS = (typeof gameState !== 'undefined' && gameState.numPlayers) || 2;
        let coveredCount = 0;
        for (let r = 0; r < BOARD_ROWS; r++)
            for (let c = 0; c < BOARD_COLS; c++)
                if (state.board[r][c] && state.covered[r][c]) coveredCount++;

        let opUncoveredCount = 0;
        for (let r = 0; r < BOARD_ROWS; r++)
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (p && p.player !== cpuPlayer && !state.covered[r][c]) opUncoveredCount++;
            }

        const isEndgameHunt = coveredCount === 0 && opUncoveredCount === 1;
        if (depth == null) {
            depth = coveredCount > 16 ? 3 : coveredCount > 6 ? 4 : isEndgameHunt ? 7 : 5;
        }
        debugLog(`Minimax: depth=${depth}, covered=${coveredCount}, opUncovered=${opUncoveredCount}`);

        const moves = getAllMoves(state, cpuPlayer, enabledAbilities);
        if (moves.length === 0) return null;

        const recentSquares = cpuRecentSquares || {};
        const lastFrom = cpuLastMoveFrom;
        const lastTo   = cpuLastMoveTo;

        const scoredMoves = [];
        let alpha = -Infinity;
        const beta = Infinity;

        for (const move of moves) {
            const newState = applyMove(state, move);
            let score = minimax(newState, depth - 1, alpha, beta, false, cpuPlayer, enabledAbilities);

            if (noise) score += (Math.random() - 0.5) * 2 * noise;

            // Oscillation penalty — suppressed when few covered pieces remain so the
            // AI can manoeuvre freely in the late game instead of stalling.
            const suppressOscillation = isEndgameHunt || coveredCount <= 3;
            if (move.type !== 'uncover' && !suppressOscillation) {
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
        // Pick randomly among moves within 3 points of the best to avoid deterministic stalemates
        const bestScore = scoredMoves[0].score;
        const topMoves = scoredMoves.filter(m => m.score >= bestScore - 3);
        const chosen = topMoves[Math.floor(Math.random() * topMoves.length)];
        debugLog(`Minimax chose: ${chosen.move.type} score=${chosen.score} (${topMoves.length} near-best)`);
        return chosen.move;
    }

    // ─── Analysis API ─────────────────────────────────────────────────────────
    // Like getBestMove but returns ALL scored moves (no oscillation/noise) so
    // the replay analyser can show what the engine considered at any position.
    function getScoredMoves({ state, cpuPlayer, enabledAbilities, depth }) {
        let coveredCount = 0;
        for (let r = 0; r < BOARD_ROWS; r++)
            for (let c = 0; c < BOARD_COLS; c++)
                if (state.board[r][c] && state.covered[r][c]) coveredCount++;

        if (depth == null) {
            let opUncovered = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (p && p.player !== cpuPlayer && !state.covered[r][c]) opUncovered++;
                }
            const hunt = coveredCount === 0 && opUncovered === 1;
            depth = coveredCount > 16 ? 3 : coveredCount > 6 ? 4 : hunt ? 7 : 5;
        }

        const moves = getAllMoves(state, cpuPlayer, enabledAbilities);
        const scored = [];
        let alpha = -Infinity;
        for (const move of moves) {
            const score = minimax(applyMove(state, move), depth - 1, alpha, Infinity, false, cpuPlayer, enabledAbilities);
            scored.push({ move, score });
            if (score > alpha) alpha = score;
        }
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }

    return { getBestMove, getScoredMoves };
})();
