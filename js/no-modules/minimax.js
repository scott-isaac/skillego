// minimax.js - Minimax AI with alpha-beta pruning for expert difficulty

const SkillMinimax = (function () {
    'use strict';

    // ─── State Representation ─────────────────────────────────────────────────
    // state = { board: 6x6 piece|null, covered: 6x6 bool }
    // Captured once from DOM; all subsequent ops are pure JS (no DOM queries).

    function captureCurrentState() {
        const board = [];
        const covered = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            board.push(new Array(BOARD_SIZE));
            covered.push(new Array(BOARD_SIZE));
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = gameState.board[r][c];
                board[r][c] = p ? { type: p.type, power: p.power, player: p.player, emoji: p.emoji } : null;
                covered[r][c] = gameState.covered[r][c];
            }
        }
        return { board, covered };
    }

    function cloneState(state) {
        const board = [];
        const covered = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            board.push(new Array(BOARD_SIZE));
            covered.push(new Array(BOARD_SIZE));
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                board[r][c] = p ? { type: p.type, power: p.power, player: p.player, emoji: p.emoji } : null;
                covered[r][c] = state.covered[r][c];
            }
        }
        return { board, covered };
    }

    // ─── Game Rules (mirrors canCapture in game.js) ───────────────────────────
    function canCapturePiece(attacker, defender) {
        if (attacker.player === defender.player) return false;
        if (defender.type === 'mouse' && attacker.type === 'dragon') return false;
        if (attacker.power >= defender.power) return true;
        if (attacker.type === 'mouse' && defender.type === 'dragon') return true;
        return false;
    }

    // ─── Move Generation ─────────────────────────────────────────────────────
    // Generates moves for one uncovered piece (no DOM).
    function getMovesForPiece(state, r, c) {
        const piece = state.board[r][c];
        if (!piece || state.covered[r][c]) return [];
        const moves = [];
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
            const target = state.board[nr][nc];
            if (!target) {
                moves.push({ type: 'move', fromR: r, fromC: c, toR: nr, toC: nc });
            } else if (!state.covered[nr][nc] && canCapturePiece(piece, target)) {
                moves.push({ type: 'capture', fromR: r, fromC: c, toR: nr, toC: nc, capPower: target.power });
            }
        }
        return moves;
    }

    // All legal moves for a player: captures (best first), regular moves, then own-piece uncovers.
    function getAllMoves(state, player) {
        const captures = [];
        const moves = [];
        const uncovers = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const piece = state.board[r][c];
                if (!piece || piece.player !== player) continue;
                if (state.covered[r][c]) {
                    uncovers.push({ type: 'uncover', r, c });
                } else {
                    for (const m of getMovesForPiece(state, r, c)) {
                        (m.type === 'capture' ? captures : moves).push(m);
                    }
                }
            }
        }
        captures.sort((a, b) => b.capPower - a.capPower);
        return [...captures, ...moves, ...uncovers];
    }

    // ─── Apply Move ───────────────────────────────────────────────────────────
    function applyMove(state, move) {
        const s = cloneState(state);
        if (move.type === 'uncover') {
            s.covered[move.r][move.c] = false;
        } else {
            s.board[move.toR][move.toC] = s.board[move.fromR][move.fromC];
            s.board[move.fromR][move.fromC] = null;
            s.covered[move.toR][move.toC] = false;
        }
        return s;
    }

    // ─── Evaluation ───────────────────────────────────────────────────────────
    // Returns score from cpuPlayer's perspective.  Positive = CPU is winning.
    function evaluate(state, cpuPlayer) {
        const opPlayer = cpuPlayer === 1 ? 2 : 1;
        let score = 0;
        let cpuDragon = null, opDragon = null;
        let cpuPieces = 0, opPieces = 0;

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (!p) continue;
                if (p.player === cpuPlayer) {
                    score += p.power * 10;
                    cpuPieces++;
                    if (p.type === 'dragon' && !state.covered[r][c]) cpuDragon = { r, c };
                } else {
                    score -= p.power * 10;
                    opPieces++;
                    if (p.type === 'dragon' && !state.covered[r][c]) opDragon = { r, c };
                }
            }
        }

        // Crude terminal detection (all pieces known, one side wiped out)
        const hasCovered = state.covered.some(row => row.some(v => v));
        if (!hasCovered) {
            if (cpuPieces === 0) return -1000;
            if (opPieces === 0) return 1000;
        }

        // Mobility: legal moves for each side (uncovered only)
        let cpuMobility = 0, opMobility = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (!p || state.covered[r][c]) continue;
                const cnt = getMovesForPiece(state, r, c).length;
                if (p.player === cpuPlayer) cpuMobility += cnt;
                else opMobility += cnt;
            }
        }
        score += (cpuMobility - opMobility) * 0.5;

        // Dragon-mouse proximity threat.
        // CRITICAL: bonus values must be LESS than dragon's material value (60)
        // so that actually capturing the dragon scores better than just threatening it.
        // Old values (90/35/12) caused the minimax to prefer "maintaining threat" over capturing.
        if (cpuDragon) {
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
        if (opDragon) {
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

        // Bonus: pieces that are adjacent to capturable opponents (attack pressure)
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = state.board[r][c];
                if (!p || state.covered[r][c]) continue;
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                for (const [dr, dc] of dirs) {
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                    const t = state.board[nr][nc];
                    if (!t || state.covered[nr][nc] || t.player === p.player) continue;
                    if (canCapturePiece(p, t)) {
                        // Adjacent capture threat — use full material value so taking is always preferred
                        const bonus = t.power * 10;
                        if (p.player === cpuPlayer) score += bonus;
                        else score -= bonus;
                    }
                }
            }
        }

        // Endgame hunt: when opponent has only 1 piece left, close in hard
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
                        // Only reward pieces that can actually capture the last enemy
                        if (!canCapturePiece(p, lastPiece)) continue;
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
        // Terminal detection with depth bonus — prefer winning sooner, losing later.
        // Must run before depth===0 so forced wins at depth>0 score higher than wins at depth 0.
        if (!state.covered.some(row => row.some(v => v))) {
            let cpuCount = 0, opCount = 0;
            for (let r = 0; r < BOARD_SIZE; r++)
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const p = state.board[r][c];
                    if (!p) continue;
                    p.player === cpuPlayer ? cpuCount++ : opCount++;
                }
            if (cpuCount === 0) return -1000 - depth; // losing later is less bad
            if (opCount  === 0) return  1000 + depth; // winning sooner scores higher
        }

        if (depth === 0) return evaluate(state, cpuPlayer);

        const currentPlayer = isMaxPlayer ? cpuPlayer : (cpuPlayer === 1 ? 2 : 1);
        const moves = getAllMoves(state, currentPlayer);

        if (moves.length === 0) {
            // No moves at all (shouldn't normally happen mid-game)
            return isMaxPlayer ? -900 : 900;
        }

        // Limit branching for performance: explore top N moves (ordered by type above)
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

        // Adaptive search depth based on how much of the board is still hidden
        let coveredCount = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (state.board[r][c] && state.covered[r][c]) coveredCount++;
            }
        }
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

        // Anti-oscillation data from real game history (same logic as hard AI's cpuRecentSquares)
        const recentSquares = gameState.cpuRecentSquares || {};
        const lastFrom = gameState.cpuLastMoveFrom;
        const lastTo   = gameState.cpuLastMoveTo;

        // Score every root move, apply oscillation penalties at this level only
        const scoredMoves = [];
        let alpha = -Infinity;
        const beta = Infinity;

        for (const move of moves) {
            const newState = applyMove(state, move);
            let score = minimax(newState, depth - 1, alpha, beta, false, gameState.cpuPlayer);

            if (move.type !== 'uncover') {
                // Penalty 1: immediate reversal (A→B when last move was B→A, same piece)
                if (lastFrom && lastTo &&
                    move.fromR === lastTo.row && move.fromC === lastTo.col &&
                    move.toR   === lastFrom.row && move.toC  === lastFrom.col) {
                    score -= 15;
                    debugLog(`Reversal penalty on ${move.fromR},${move.fromC}→${move.toR},${move.toC}`);
                }

                // Penalty 2: returning to any recently-visited square (per piece type)
                // Reuses gameState.cpuRecentSquares built up by executeCpuMove
                const piece = state.board[move.fromR][move.fromC];
                if (piece) {
                    const history = recentSquares[piece.type] || [];
                    const visits = history.filter(s => s.row === move.toR && s.col === move.toC).length;
                    if (visits > 0) {
                        score -= visits * 8;
                        debugLog(`Oscillation penalty ×${visits} for ${piece.type} → (${move.toR},${move.toC})`);
                    }
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
