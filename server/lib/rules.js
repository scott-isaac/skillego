'use strict';

// Factory — returns all rule functions bound to a specific board size.
// Each GameRoom creates its own instance so multiple games with different
// board dimensions run concurrently without shared mutable globals.
function createRules({ rows, cols, burnLevel }) {
    const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

    function inBounds(r, c) {
        return r >= 0 && r < rows && c >= 0 && c < cols;
    }

    // ─── Capture Rules ────────────────────────────────────────────────────────
    function canCapture(attacker, defender) {
        if (attacker.player === defender.player) return false;
        if (defender.burning && defender.power > 1 && attacker.type === 'mouse') return false;
        if (attacker.burning && defender.type === 'mouse') return true;
        if (defender.type === 'mouse' && attacker.type === 'dragon') return false;
        if (attacker.power >= defender.power) return true;
        if (attacker.type === 'mouse' && defender.type === 'dragon') return true;
        return false;
    }

    // ─── Standard Move Generation ─────────────────────────────────────────────
    function getValidMoves(state, r, c) {
        const piece = state.board[r][c];
        if (!piece || state.covered[r][c]) return [];
        const moves = [];
        for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (!inBounds(nr, nc)) continue;
            const target = state.board[nr][nc];
            if (!target) {
                moves.push({ row: nr, col: nc });
            } else if (!state.covered[nr][nc] && canCapture(piece, target)) {
                moves.push({ row: nr, col: nc });
            }
        }
        return moves;
    }

    // ─── Ability Move Generation ──────────────────────────────────────────────
    function getPushMoves(state, r, c, enabledAbilities) {
        if (!enabledAbilities.has('push')) return [];
        const piece = state.board[r][c];
        if (!piece || piece.burning || piece.type !== 'dragon') return [];
        const result = [];
        for (const [dr, dc] of DIRS) {
            const er = r + dr, ec = c + dc;
            const destR = r + 2*dr, destC = c + 2*dc;
            if (!inBounds(er, ec) || !inBounds(destR, destC)) continue;
            const enemy = state.board[er][ec];
            if (!enemy || enemy.player === piece.player || state.covered[er][ec]) continue;
            if (state.board[destR][destC] !== null) continue;
            result.push({ type: 'push', drR: r, drC: c, enemyR: er, enemyC: ec, destR, destC });
        }
        return result;
    }

    function getHopMoves(state, r, c, enabledAbilities) {
        if (!enabledAbilities.has('hop')) return [];
        const piece = state.board[r][c];
        if (!piece || piece.burning || piece.type !== 'mouse') return [];
        const result = [];
        for (const [dr, dc] of DIRS) {
            const midR = r + dr, midC = c + dc;
            const landR = r + 2*dr, landC = c + 2*dc;
            if (!inBounds(midR, midC) || !inBounds(landR, landC)) continue;
            if (!state.board[midR][midC]) continue;
            if (state.board[landR][landC] !== null) continue;
            result.push({ type: 'hop', fromR: r, fromC: c, toR: landR, toC: landC });
        }
        return result;
    }

    function getEngulfMoves(state, r, c, enabledAbilities) {
        if (!enabledAbilities.has('engulf')) return [];
        const piece = state.board[r][c];
        if (!piece || piece.burning || piece.type !== 'dragon') return [];
        for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (!inBounds(nr, nc)) continue;
            const t = state.board[nr][nc];
            if (t && t.type === 'mouse' && t.player !== piece.player && !state.covered[nr][nc]) {
                return [{ type: 'engulf', r, c }];
            }
        }
        return [];
    }

    function getTransformMoves(state, r, c, enabledAbilities) {
        if (!enabledAbilities.has('transform')) return [];
        const piece = state.board[r][c];
        if (!piece || piece.burning || piece.type !== 'wizard') return [];
        const result = [];
        for (const [dr, dc] of DIRS) {
            const cells = [
                { r,           c           },
                { r: r+dr,     c: c+dc     },
                { r: r+2*dr,   c: c+2*dc   },
                { r: r+3*dr,   c: c+3*dc   },
            ];
            if (cells.slice(1).every(({ r: cr, c: cc }) => inBounds(cr, cc) && state.board[cr][cc] === null)) {
                result.push({ type: 'transform', wizR: r, wizC: c, cells, isExplosion: false });
            }
        }
        const explodeCells = DIRS.map(([dr, dc]) => ({ r: r+dr, c: c+dc }));
        if (explodeCells.every(({ r: cr, c: cc }) => inBounds(cr, cc) && state.board[cr][cc] === null)) {
            result.push({ type: 'transform', wizR: r, wizC: c, cells: explodeCells, isExplosion: true });
        }
        return result;
    }

    function getSnipeMoves(state, r, c, enabledAbilities) {
        if (!enabledAbilities.has('snipe')) return [];
        const piece = state.board[r][c];
        if (!piece || piece.burning || piece.type !== 'robot') return [];
        const result = [];
        for (const [dr, dc] of DIRS) {
            let tr = r + dr, tc = c + dc;
            let targetR = -1, targetC = -1;
            while (inBounds(tr, tc)) {
                if (state.board[tr][tc]) { targetR = tr; targetC = tc; break; }
                tr += dr; tc += dc;
            }
            if (targetR === -1) continue;
            const target = state.board[targetR][targetC];
            if (target.player === piece.player || state.covered[targetR][targetC]) continue;
            let spotterR = -1, spotterC = -1;
            for (const [ar, ac] of DIRS) {
                const cr = targetR + ar, cc = targetC + ac;
                if (!inBounds(cr, cc)) continue;
                const cat = state.board[cr][cc];
                if (cat && cat.type === 'cat' && cat.player === piece.player
                        && !cat.burning && !state.covered[cr][cc]) {
                    spotterR = cr; spotterC = cc; break;
                }
            }
            if (spotterR !== -1) {
                result.push({ type: 'snipe', robotR: r, robotC: c, targetR, targetC, spotterR, spotterC });
            }
        }
        return result;
    }

    function getPyroMoves(state, r, c, enabledAbilities) {
        if (!enabledAbilities.has('pyromania')) return [];
        const piece = state.board[r][c];
        if (!piece || !piece.burning) return [];
        const result = [];
        for (const [dr, dc] of DIRS) {
            const tr = r + dr, tc = c + dc;
            if (!inBounds(tr, tc)) continue;
            const target = state.board[tr][tc];
            if (!target || target.player === piece.player || target.burning || state.covered[tr][tc]) continue;
            result.push({ type: 'pyro', fromR: r, fromC: c, targetR: tr, targetC: tc });
        }
        return result;
    }

    // ─── State Clone ──────────────────────────────────────────────────────────
    function cloneState(state) {
        const board = [];
        const covered = [];
        for (let r = 0; r < rows; r++) {
            board.push(new Array(cols));
            covered.push(new Array(cols));
            for (let c = 0; c < cols; c++) {
                const p = state.board[r][c];
                board[r][c] = p ? { ...p } : null;
                covered[r][c] = state.covered[r][c];
            }
        }
        return { board, covered };
    }

    // ─── Apply Move (pure — returns new state, never mutates input) ───────────
    function applyMoveToState(state, move) {
        const s = cloneState(state);
        switch (move.type) {
            case 'uncover':
                s.covered[move.r][move.c] = false;
                break;
            case 'move':
            case 'capture': {
                const piece = s.board[move.fromR][move.fromC];
                s.board[move.toR][move.toC] = piece;
                s.board[move.fromR][move.fromC] = null;
                s.covered[move.toR][move.toC] = false;
                if (piece.burning) {
                    piece.power--;
                    if (piece.power <= 0) {
                        s.board[move.toR][move.toC] = null;
                    } else {
                        piece.type = burnLevel[piece.power].type;
                    }
                }
                break;
            }
            case 'hop': {
                const piece = s.board[move.fromR][move.fromC];
                s.board[move.toR][move.toC] = piece;
                s.board[move.fromR][move.fromC] = null;
                s.covered[move.toR][move.toC] = false;
                break;
            }
            case 'push': {
                const enemy = s.board[move.enemyR][move.enemyC];
                s.board[move.destR][move.destC] = enemy;
                s.covered[move.destR][move.destC] = false;
                s.board[move.enemyR][move.enemyC] = null;
                break;
            }
            case 'engulf':
                s.board[move.r][move.c].burning = true;
                break;
            case 'transform': {
                const player = s.board[move.wizR][move.wizC].player;
                s.board[move.wizR][move.wizC] = null;
                s.covered[move.wizR][move.wizC] = false;
                for (const { r, c } of move.cells) {
                    if (inBounds(r, c) && s.board[r][c] === null) {
                        s.board[r][c] = { type: 'mouse', power: 1, player, burning: false };
                        s.covered[r][c] = false;
                    }
                }
                break;
            }
            case 'snipe': {
                const robot = s.board[move.robotR][move.robotC];
                s.board[move.targetR][move.targetC] = robot;
                s.covered[move.targetR][move.targetC] = false;
                s.board[move.robotR][move.robotC] = null;
                break;
            }
            case 'pyro': {
                const burner = s.board[move.fromR][move.fromC];
                s.board[move.targetR][move.targetC].burning = true;
                burner.power--;
                if (burner.power <= 0) {
                    s.board[move.fromR][move.fromC] = null;
                } else {
                    burner.type = burnLevel[burner.power].type;
                }
                break;
            }
        }
        return s;
    }

    return {
        DIRS, rows, cols,
        inBounds, canCapture,
        getValidMoves, getPushMoves, getHopMoves, getEngulfMoves,
        getTransformMoves, getSnipeMoves, getPyroMoves,
        cloneState, applyMoveToState,
    };
}

module.exports = { createRules };
