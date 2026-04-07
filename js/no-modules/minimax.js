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
    // Returns true if transform is tactically useful:
    // - places a mouse adjacent to enemy dragon (immediate threat)
    // - places mice within 3 squares of enemy dragon (multi-turn hunt setup)
    // - enemy dragon exists and we have no/few mice (need to create them)
    // - few opponent pieces remain and we have no mice
    function transformIsWorthIt(state, move, player) {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p || p.player === player || p.player === 0 || p.type !== 'dragon' || state.covered[r][c] || p.burning) continue;
                // Does any mouse cell land adjacent to the dragon? (immediate kill threat)
                for (const { r: mr, c: mc } of move.cells) {
                    if (Math.abs(mr - r) + Math.abs(mc - c) === 1) return true;
                }
                // Does transform create multiple mice within 3 squares? (hunt setup)
                let nearCount = 0;
                for (const { r: mr, c: mc } of move.cells) {
                    if (Math.abs(mr - r) + Math.abs(mc - c) <= 3) nearCount++;
                }
                if (nearCount >= 2) return true;
                // Do we have few/no mice to hunt the dragon with?
                let ownMice = 0, opCount = 0;
                for (let pr = 0; pr < BOARD_ROWS; pr++)
                    for (let pc = 0; pc < BOARD_COLS; pc++) {
                        const pp = state.board[pr][pc];
                        if (!pp || pp.player === 0) continue;
                        if (pp.player !== player && pp.player !== 0) opCount++;
                        if (pp.player === player && pp.type === 'mouse' && !state.covered[pr][pc]) ownMice++;
                    }
                if (ownMice <= 1) return true;  // need more mice to hunt dragon
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

        // Mobility — simple move count (fast, called millions of times)
        let cpuMobility = 0, opMobility = 0;
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p || p.player === 0 || state.covered[r][c]) continue;
                const cnt = getValidMoves(state, r, c).length;
                if (p.player === cpuPlayer) cpuMobility += cnt;
                else opMobility += cnt;
            }
        }
        score += (cpuMobility - opMobility) * 0.5;

        // Dragon-mouse proximity — scaled by mouse count near the dragon.
        // A lone mouse chasing a mobile dragon is futile; multiple mice
        // converging is a real kill threat. Suppressed when dragon is burning.
        if (cpuDragon && !cpuDragon.burning) {
            // Count enemy mice within striking range of CPU dragon
            let nearMice = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player !== cpuPlayer && p.player !== 0 && !state.covered[r][c])
                        if (Math.abs(r - cpuDragon.r) + Math.abs(c - cpuDragon.c) <= 5) nearMice++;
                }
            // Scale: 1 mouse=0.6x, 2=1.0x, 3+=1.4x
            const threatScale = nearMice <= 1 ? 0.6 : nearMice === 2 ? 1.0 : 1.4;
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player !== cpuPlayer && p.player !== 0 && !state.covered[r][c]) {
                        const d = Math.abs(r - cpuDragon.r) + Math.abs(c - cpuDragon.c);
                        if (d === 1) score -= 45 * threatScale;
                        else if (d === 2) score -= 18 * threatScale;
                        else if (d === 3) score -= 7 * threatScale;
                        else if (d === 4) score -= 4 * threatScale;
                    }
                }
            }
            // Defensive: reward CPU dragon for having MORE escape routes when mice are near
            if (nearMice >= 2) {
                let dragonMoves = 0;
                for (const [dr, dc] of DIRS) {
                    const nr = cpuDragon.r + dr, nc = cpuDragon.c + dc;
                    if (inBounds(nr, nc) && !state.board[nr][nc]) dragonMoves++;
                }
                score += dragonMoves * 8 * Math.min(nearMice, 4);
            }
        }
        if (opDragon && !opDragon.burning) {
            // Count CPU mice within striking range of opponent dragon
            let nearMice = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player === cpuPlayer && !state.covered[r][c])
                        if (Math.abs(r - opDragon.r) + Math.abs(c - opDragon.c) <= 5) nearMice++;
                }
            // Scale: 1 mouse=0.4x (lone chase is almost useless), 2=1.0x, 3+=1.5x
            const huntScale = nearMice <= 1 ? 0.4 : nearMice === 2 ? 1.0 : 1.5;
            // Proximity bonus — extended range so mice converge from further out
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = state.board[r][c];
                    if (p && p.type === 'mouse' && p.player === cpuPlayer && !state.covered[r][c]) {
                        const d = Math.abs(r - opDragon.r) + Math.abs(c - opDragon.c);
                        if (d === 1) score += 45 * huntScale;
                        else if (d === 2) score += 25 * huntScale;
                        else if (d === 3) score += 12 * huntScale;
                        else if (d === 4) score += 6 * huntScale;
                        else if (d === 5) score += 3 * huntScale;
                    }
                }
            }
            // Dragon mobility restriction — reward positions where mice cut off
            // the dragon's escape routes. This makes mice surround rather than
            // single-file chase. Only meaningful with 2+ mice in the area.
            if (nearMice >= 2) {
                let dragonMoves = 0;
                for (const [dr, dc] of DIRS) {
                    const nr = opDragon.r + dr, nc = opDragon.c + dc;
                    if (inBounds(nr, nc) && !state.board[nr][nc]) dragonMoves++;
                }
                // Fewer escape routes = bigger bonus. Max 4 moves on open board.
                // Bonus per restricted square scales with mouse count.
                score += (4 - dragonMoves) * 12 * Math.min(nearMice, 4);
            }
        }

        // Attack pressure: small bonus for being adjacent to capturable opponents.
        // Must be much less than material value (power * 10) so the AI strongly
        // prefers actually capturing over just being adjacent.
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
                        const bonus = t.power * 3;
                        if (p.player === cpuPlayer) score += bonus;
                        else score -= bonus;
                    }
                }
            }
        }

        // (Safety is handled by the search tree — the deeper we search,
        //  the better we see threats. Keep the eval fast and let depth do the work.)

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

        // Late-game pursuit — when board is mostly open, reward closing distance
        // on capturable opponents. Intensity scales with how few pieces remain.
        if (!hasCovered) {
            // Full endgame hunt: ≤3 opponent pieces — maximum aggression
            // Mid-late pursuit: 4-6 opponent pieces — moderate close-distance bonus
            const isFullHunt = opPieces <= 3;
            const isMidLate  = opPieces <= 6;
            if (isMidLate) {
                const huntScale = isFullHunt ? 1.0 : 0.4;
                for (let er = 0; er < BOARD_ROWS; er++) {
                    for (let ec = 0; ec < BOARD_COLS; ec++) {
                        const t = state.board[er][ec];
                        if (!t || t.player === cpuPlayer || t.player === 0 || state.covered[er][ec]) continue;
                        for (let r = 0; r < BOARD_ROWS; r++)
                            for (let c = 0; c < BOARD_COLS; c++) {
                                const p = state.board[r][c];
                                if (!p || p.player !== cpuPlayer || state.covered[r][c]) continue;
                                const dist = Math.abs(r - er) + Math.abs(c - ec);
                                if (canCapture(p, t)) {
                                    score += Math.max(0, 12 - dist) * 18 * huntScale;
                                } else {
                                    score += Math.max(0, 8 - dist) * 6 * huntScale;
                                }
                            }
                    }
                }
                if (isFullHunt) score -= opMobility * 20;
                else score -= opMobility * 8;
            }
        } else if (coveredCount <= 6) {
            // Board is mostly open but a few covered cells remain —
            // light pursuit bonus so pieces don't idle while waiting to uncover.
            for (let er = 0; er < BOARD_ROWS; er++) {
                for (let ec = 0; ec < BOARD_COLS; ec++) {
                    const t = state.board[er][ec];
                    if (!t || t.player === cpuPlayer || t.player === 0 || state.covered[er][ec]) continue;
                    for (let r = 0; r < BOARD_ROWS; r++)
                        for (let c = 0; c < BOARD_COLS; c++) {
                            const p = state.board[r][c];
                            if (!p || p.player !== cpuPlayer || state.covered[r][c]) continue;
                            if (!canCapture(p, t)) continue;
                            const dist = Math.abs(r - er) + Math.abs(c - ec);
                            score += Math.max(0, 10 - dist) * 3;
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

        const isEndgameHunt = coveredCount === 0 && opUncoveredCount <= 5;
        if (depth == null) {
            depth = coveredCount > 16 ? 3
                  : coveredCount > 6  ? 4
                  : opUncoveredCount <= 1 ? 7       // single piece left — deep hunt
                  : isEndgameHunt     ? 6           // few pieces, open board — deeper search
                  : 5;
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

            // Oscillation penalty — suppressed for captures (always worth considering)
            // and during endgame hunt (free manoeuvring for zugzwang).
            const isCapture = move.type === 'capture' || move.type === 'snipe';
            if (move.type !== 'uncover' && !isCapture && !isEndgameHunt) {
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
            const hunt = coveredCount === 0 && opUncovered <= 5;
            depth = coveredCount > 16 ? 3
                  : coveredCount > 6  ? 4
                  : opUncovered <= 1  ? 7
                  : hunt              ? 6
                  : 5;
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
