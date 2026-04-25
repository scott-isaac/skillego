// classic-ai.js — Extended Classic AI: original Flash game's deep negamax engine
// upgraded with Skillego's full ability moveset.
//
// Core: negamax + alpha-beta, iterative deepening with 500ms time budget,
// incremental material evaluation, piece arrays with isDead flags.
// Extended: hop, push, snipe, transform, engulf (last resort), pyro.

const ClassicAI = (function () {
    'use strict';

    const INFINITY = 100000;
    const DEFAULT_TIME_MS = 500;
    const DIRS = [[-1,0],[0,-1],[1,0],[0,1]];
    const BURN_LEVEL = {};
    PIECES.forEach(p => { BURN_LEVEL[p.power] = p.type; });

    function inB(r, c) { return r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS; }
    function isBlocked(r, c) {
        for (const b of pushBlocked) { if (b.row === r && b.col === c) return true; }
        return false;
    }

    function canCap(a, d) {
        if (a.player === d.player) return false;
        if (d.burning && d.power > 1 && a.type === 'mouse') return false;
        if (a.burning && d.type === 'mouse') return true;
        if (d.type === 'mouse' && a.type === 'dragon') return false;
        if (a.power >= d.power) return true;
        if (a.type === 'mouse' && d.type === 'dragon') return true;
        return false;
    }

    // ── Search state ─────────────────────────────────────────────────────
    let board, covered, pushBlocked, staticValue, p1Pieces, p2Pieces, hasUnknown, abilities;

    function sv(p) { return p.player === 1 ? p.power : -p.power; }
    function getPieces(player) { return player === 1 ? p1Pieces : p2Pieces; }

    function initSearch(state, cpuPlayer, enabledAbilities) {
        board = []; covered = [];
        pushBlocked = state.pushBlocked ? [...state.pushBlocked] : [];
        p1Pieces = []; p2Pieces = [];
        staticValue = 0; hasUnknown = false;
        abilities = enabledAbilities;

        for (let r = 0; r < BOARD_ROWS; r++) {
            board[r] = new Array(BOARD_COLS);
            covered[r] = new Array(BOARD_COLS);
            for (let c = 0; c < BOARD_COLS; c++) {
                const src = state.board[r][c];
                covered[r][c] = state.covered[r][c];
                if (!src) {
                    board[r][c] = null;
                } else if (state.covered[r][c]) {
                    board[r][c] = { type: 'unknown', power: 0, player: 0, r, c,
                                    isDead: false, burning: false };
                    hasUnknown = true;
                } else {
                    const p = { type: src.type, power: src.power, player: src.player,
                                r, c, isDead: false, burning: !!src.burning };
                    board[r][c] = p;
                    (p.player === 1 ? p1Pieces : p2Pieces).push(p);
                    staticValue += sv(p);
                }
            }
        }
        p1Pieces.sort((a, b) => b.power - a.power);
        p2Pieces.sort((a, b) => b.power - a.power);
    }

    // ── Move generation for search ───────────────────────────────────────
    // Returns { captures, quiets } — captures include snipe.
    // Abilities pruned: engulf=last resort, pyro=target value>=burner, rest=always.
    function genMoves(player) {
        const captures = [], quiets = [];
        const pieces = getPieces(player);

        for (let pi = 0; pi < pieces.length; pi++) {
            const p = pieces[pi];
            if (p.isDead) continue;
            const pr = p.r, pc = p.c;

            // ── Standard moves + captures ────────────────────────────
            const sd = (Math.random() * 4) | 0;
            for (let di = 0; di < 4; di++) {
                const dir = (di + sd) % 4;
                const nr = pr + DIRS[dir][0], nc = pc + DIRS[dir][1];
                if (!inB(nr, nc)) continue;
                const t = board[nr][nc];
                if (t === null) {
                    if (!isBlocked(nr, nc)) quiets.push({ kind: 'move', p, pr, pc, nr, nc, t: null });
                } else if (t.player !== 0 && t.player !== p.player && canCap(p, t)) {
                    captures.push({ kind: 'cap', p, pr, pc, nr, nc, t });
                }
            }

            // ── Hop (mouse, not burning) ─────────────────────────────
            if (abilities.has('hop') && p.type === 'mouse' && !p.burning) {
                for (const [dr, dc] of DIRS) {
                    const mr = pr + dr, mc = pc + dc;
                    const lr = pr + 2*dr, lc = pc + 2*dc;
                    if (!inB(mr, mc) || !inB(lr, lc)) continue;
                    if (board[mr][mc] === null || board[lr][lc] !== null || isBlocked(lr, lc)) continue;
                    quiets.push({ kind: 'hop', p, pr, pc, nr: lr, nc: lc, t: null });
                }
            }

            // ── Push (dragon, not burning) ───────────────────────────
            if (abilities.has('push') && p.type === 'dragon' && !p.burning) {
                for (const [dr, dc] of DIRS) {
                    const er = pr + dr, ec = pc + dc;
                    const dest_r = pr + 2*dr, dest_c = pc + 2*dc;
                    if (!inB(er, ec) || !inB(dest_r, dest_c)) continue;
                    const enemy = board[er][ec];
                    if (!enemy || enemy.player === p.player || enemy.player === 0 || covered[er][ec]) continue;
                    if (board[dest_r][dest_c] !== null || isBlocked(dest_r, dest_c)) continue;
                    quiets.push({ kind: 'push', p, pr, pc, er, ec, dest_r, dest_c, enemy });
                }
            }

            // ── Snipe (robot, not burning) ───────────────────────────
            if (abilities.has('snipe') && p.type === 'robot' && !p.burning) {
                for (const [dr, dc] of DIRS) {
                    let tr = pr + dr, tc = pc + dc;
                    let targetR = -1, targetC = -1;
                    while (inB(tr, tc)) {
                        if (board[tr][tc] !== null) { targetR = tr; targetC = tc; break; }
                        tr += dr; tc += dc;
                    }
                    if (targetR === -1) continue;
                    const target = board[targetR][targetC];
                    if (target.player === p.player || target.player === 0 || covered[targetR][targetC]) continue;
                    // Need friendly non-burning cat adjacent to target
                    let hasSpotter = false;
                    for (const [ar, ac] of DIRS) {
                        const cr = targetR + ar, cc = targetC + ac;
                        if (!inB(cr, cc)) continue;
                        const cat = board[cr][cc];
                        if (cat && cat.type === 'cat' && cat.player === p.player && !cat.burning && !cat.isDead) {
                            hasSpotter = true; break;
                        }
                    }
                    if (hasSpotter) {
                        captures.push({ kind: 'snipe', p, pr, pc, nr: targetR, nc: targetC, t: target });
                    }
                }
            }

            // ── Transform (wizard, not burning) ──────────────────────
            if (abilities.has('transform') && p.type === 'wizard' && !p.burning) {
                // Line transforms (4 directions)
                for (const [dr, dc] of DIRS) {
                    let valid = true;
                    const cells = [{ r: pr, c: pc }];
                    for (let step = 1; step <= 3; step++) {
                        const cr = pr + step*dr, cc = pc + step*dc;
                        if (!inB(cr, cc) || board[cr][cc] !== null || isBlocked(cr, cc)) { valid = false; break; }
                        cells.push({ r: cr, c: cc });
                    }
                    if (valid) {
                        quiets.push({ kind: 'transform', p, pr, pc, cells, isExplosion: false });
                    }
                }
                // Explosion
                const eCells = DIRS.map(([dr, dc]) => ({ r: pr + dr, c: pc + dc }));
                if (eCells.every(({ r, c }) => inB(r, c) && board[r][c] === null && !isBlocked(r, c))) {
                    quiets.push({ kind: 'transform', p, pr, pc, cells: eCells, isExplosion: true });
                }
            }

            // ── Engulf (dragon, not burning) — LAST RESORT ONLY ──────
            // Only if: adjacent enemy mouse AND can't capture/push/escape
            if (abilities.has('engulf') && p.type === 'dragon' && !p.burning) {
                let adjacentMouse = false;
                let canEscape = false;
                for (const [dr, dc] of DIRS) {
                    const nr = pr + dr, nc = pc + dc;
                    if (!inB(nr, nc)) continue;
                    const adj = board[nr][nc];
                    if (adj && adj.type === 'mouse' && adj.player !== p.player && !covered[nr][nc]) {
                        adjacentMouse = true;
                    }
                }
                if (adjacentMouse) {
                    // Can we capture any adjacent mouse?
                    let canCapMouse = false;
                    for (const [dr, dc] of DIRS) {
                        const nr = pr + dr, nc = pc + dc;
                        if (!inB(nr, nc)) continue;
                        const adj = board[nr][nc];
                        if (adj && adj.type === 'mouse' && adj.player !== p.player && !covered[nr][nc]) {
                            if (canCap(p, adj)) canCapMouse = true;
                        }
                    }
                    // Can we push any adjacent mouse?
                    let canPushMouse = false;
                    if (abilities.has('push')) {
                        for (const [dr, dc] of DIRS) {
                            const er = pr + dr, ec = pc + dc;
                            if (!inB(er, ec)) continue;
                            const adj = board[er][ec];
                            if (adj && adj.type === 'mouse' && adj.player !== p.player && !covered[er][ec]) {
                                const dest_r = pr + 2*dr, dest_c = pc + 2*dc;
                                if (inB(dest_r, dest_c) && board[dest_r][dest_c] === null && !isBlocked(dest_r, dest_c)) canPushMouse = true;
                            }
                        }
                    }
                    // Can we move to a safe square? (no adjacent enemy mouse or dragon)
                    if (!canCapMouse && !canPushMouse) {
                        for (const [dr, dc] of DIRS) {
                            const nr = pr + dr, nc = pc + dc;
                            if (!inB(nr, nc) || board[nr][nc] !== null || isBlocked(nr, nc)) continue;
                            let safe = true;
                            for (const [dr2, dc2] of DIRS) {
                                const ar = nr + dr2, ac = nc + dc2;
                                if (!inB(ar, ac)) continue;
                                const adj = board[ar][ac];
                                if (adj && adj.player !== p.player && !covered[ar][ac] &&
                                    (adj.type === 'mouse' || (adj.type === 'dragon' && adj.power >= p.power))) {
                                    safe = false; break;
                                }
                            }
                            if (safe) { canEscape = true; break; }
                        }
                        if (!canEscape) {
                            quiets.push({ kind: 'engulf', p, pr, pc });
                        }
                    }
                }
            }

            // ── Pyro (any burning piece) ─────────────────────────────
            if (abilities.has('pyromania') && p.burning) {
                for (const [dr, dc] of DIRS) {
                    const tr = pr + dr, tc = pc + dc;
                    if (!inB(tr, tc)) continue;
                    const target = board[tr][tc];
                    if (!target || target.player === p.player || target.burning || target.player === 0 || covered[tr][tc]) continue;
                    if (target.power >= p.power) {  // only pyro worthwhile targets
                        quiets.push({ kind: 'pyro', p, pr, pc, tr, tc, target });
                    }
                }
            }
        }

        captures.sort((a, b) => b.t.power - a.t.power || a.p.power - b.p.power);
        return { captures, quiets };
    }

    // ── Make / Unmake ────────────────────────────────────────────────────
    // Returns an undo object to pass to unmake.
    function makeMove(m) {
        // Save and clear push-blocked squares (they expire after 1 ply)
        m._prevBlocked = pushBlocked;
        pushBlocked = [];
        switch (m.kind) {
            case 'move':
            case 'hop': {
                board[m.nr][m.nc] = m.p;
                m.p.r = m.nr; m.p.c = m.nc;
                board[m.pr][m.pc] = null;
                // Burning piece loses power on move
                if (m.p.burning) {
                    m._oldPow = m.p.power; m._oldType = m.p.type;
                    staticValue -= sv(m.p);
                    m.p.power--;
                    if (m.p.power <= 0) {
                        m.p.isDead = true;
                        board[m.nr][m.nc] = null;
                        m._burnedOut = true;
                    } else {
                        m.p.type = BURN_LEVEL[m.p.power];
                        staticValue += sv(m.p);
                        m._burnedOut = false;
                    }
                    return;
                }
                return;
            }
            case 'cap':
            case 'snipe': {
                board[m.nr][m.nc] = m.p;
                m.p.r = m.nr; m.p.c = m.nc;
                board[m.pr][m.pc] = null;
                m.t.isDead = true;
                staticValue -= sv(m.t);
                // Burning attacker loses power
                if (m.p.burning) {
                    m._oldPow = m.p.power; m._oldType = m.p.type;
                    staticValue -= sv(m.p);
                    m.p.power--;
                    if (m.p.power <= 0) {
                        m.p.isDead = true;
                        board[m.nr][m.nc] = null;
                        m._burnedOut = true;
                    } else {
                        m.p.type = BURN_LEVEL[m.p.power];
                        staticValue += sv(m.p);
                        m._burnedOut = false;
                    }
                }
                return;
            }
            case 'push': {
                board[m.dest_r][m.dest_c] = m.enemy;
                m.enemy.r = m.dest_r; m.enemy.c = m.dest_c;
                board[m.er][m.ec] = null;
                pushBlocked = [{ row: m.er, col: m.ec }];
                return;
            }
            case 'engulf': {
                m.p.burning = true;
                // No staticValue change — same power, just burning now
                return;
            }
            case 'transform': {
                // Remove wizard
                staticValue -= sv(m.p);
                m.p.isDead = true;
                board[m.pr][m.pc] = null;
                // Create 4 mice
                m._mice = [];
                const arr = getPieces(m.p.player);
                for (const { r, c } of m.cells) {
                    if (inB(r, c) && board[r][c] === null) {
                        const mouse = { type: 'mouse', power: 1, player: m.p.player,
                                        r, c, isDead: false, burning: false };
                        board[r][c] = mouse;
                        arr.push(mouse);
                        staticValue += sv(mouse);
                        m._mice.push(mouse);
                    }
                }
                return;
            }
            case 'pyro': {
                m.target.burning = true;
                // Burner loses 1 power
                m._oldPow = m.p.power; m._oldType = m.p.type;
                staticValue -= sv(m.p);
                m.p.power--;
                if (m.p.power <= 0) {
                    m.p.isDead = true;
                    board[m.pr][m.pc] = null;
                    m._burnedOut = true;
                } else {
                    m.p.type = BURN_LEVEL[m.p.power];
                    staticValue += sv(m.p);
                    m._burnedOut = false;
                }
                return;
            }
        }
    }

    function unmakeMove(m) {
        pushBlocked = m._prevBlocked;
        switch (m.kind) {
            case 'move':
            case 'hop': {
                if (m.p.burning) {
                    if (m._burnedOut) {
                        m.p.isDead = false;
                        board[m.nr][m.nc] = m.p;
                    } else {
                        staticValue -= sv(m.p);
                    }
                    m.p.power = m._oldPow; m.p.type = m._oldType;
                    staticValue += sv(m.p);
                }
                board[m.pr][m.pc] = m.p;
                m.p.r = m.pr; m.p.c = m.pc;
                board[m.nr][m.nc] = null;
                return;
            }
            case 'cap':
            case 'snipe': {
                if (m.p.burning) {
                    if (m._burnedOut) {
                        m.p.isDead = false;
                    } else {
                        staticValue -= sv(m.p);
                    }
                    m.p.power = m._oldPow; m.p.type = m._oldType;
                    staticValue += sv(m.p);
                }
                board[m.pr][m.pc] = m.p;
                m.p.r = m.pr; m.p.c = m.pc;
                m.t.isDead = false;
                board[m.nr][m.nc] = m.t;
                staticValue += sv(m.t);
                return;
            }
            case 'push': {
                board[m.er][m.ec] = m.enemy;
                m.enemy.r = m.er; m.enemy.c = m.ec;
                board[m.dest_r][m.dest_c] = null;
                return;
            }
            case 'engulf': {
                m.p.burning = false;
                return;
            }
            case 'transform': {
                // Remove mice
                const arr = getPieces(m.p.player);
                for (const mouse of m._mice) {
                    board[mouse.r][mouse.c] = null;
                    staticValue -= sv(mouse);
                    const idx = arr.indexOf(mouse);
                    if (idx >= 0) arr.splice(idx, 1);
                }
                // Restore wizard
                m.p.isDead = false;
                board[m.pr][m.pc] = m.p;
                staticValue += sv(m.p);
                return;
            }
            case 'pyro': {
                m.target.burning = false;
                if (m._burnedOut) {
                    m.p.isDead = false;
                    board[m.pr][m.pc] = m.p;
                } else {
                    staticValue -= sv(m.p);
                }
                m.p.power = m._oldPow; m.p.type = m._oldType;
                staticValue += sv(m.p);
                return;
            }
        }
    }

    // ── Negamax ──────────────────────────────────────────────────────────
    function negamax(player, depth, alpha, beta) {
        if (depth <= 0) {
            return player === 1 ? staticValue : -staticValue;
        }

        const opponent = player === 1 ? 2 : 1;

        if (hasUnknown) {
            const val = -negamax(opponent, depth - 1, -beta, -alpha);
            if (val > alpha) alpha = val;
            if (alpha >= beta) return alpha;
        }

        const { captures, quiets } = genMoves(player);
        const allMoves = captures.concat(quiets);

        for (let i = 0; i < allMoves.length; i++) {
            const m = allMoves[i];
            makeMove(m);
            const val = -negamax(opponent, depth - 1, -beta, -alpha);
            unmakeMove(m);
            if (val > alpha) alpha = val;
            if (alpha >= beta) return alpha;
        }

        return alpha;
    }

    // ── Uncover heuristic (3-tier from original) ─────────────────────────
    function pickUncover(state, player) {
        const uncovers = [];
        for (let r = 0; r < BOARD_ROWS; r++)
            for (let c = 0; c < BOARD_COLS; c++)
                if (state.board[r][c] && state.covered[r][c])
                    uncovers.push({ type: 'uncover', r, c });
        if (uncovers.length === 0) return null;

        for (let i = uncovers.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            const tmp = uncovers[i]; uncovers[i] = uncovers[j]; uncovers[j] = tmp;
        }

        for (const u of uncovers) {
            let maxF = 0, maxE = 0;
            for (const [dr, dc] of DIRS) {
                const nr = u.r + dr, nc = u.c + dc;
                if (!inB(nr, nc)) continue;
                const adj = state.board[nr][nc];
                if (!adj || state.covered[nr][nc]) continue;
                if (adj.player === player) { if (adj.power > maxF) maxF = adj.power; }
                else { if (adj.power > maxE) maxE = adj.power; }
            }
            if (maxF > 3 && maxF >= maxE) return u;
        }
        for (const u of uncovers) {
            let maxF = 0, maxE = 0;
            for (const [dr, dc] of DIRS) {
                const nr = u.r + dr, nc = u.c + dc;
                if (!inB(nr, nc)) continue;
                const adj = state.board[nr][nc];
                if (!adj || state.covered[nr][nc]) continue;
                if (adj.player === player) { if (adj.power > maxF) maxF = adj.power; }
                else { if (adj.power > maxE) maxE = adj.power; }
            }
            if (!(maxF > 0 && maxF <= 3 || maxE > 0 && maxF <= maxE)) return u;
        }
        return uncovers[0];
    }

    // ── Convert internal move to game move format ────────────────────────
    function toGameMove(m) {
        switch (m.kind) {
            case 'move': return { type: 'move', fromR: m.pr, fromC: m.pc, toR: m.nr, toC: m.nc };
            case 'cap':  return { type: 'capture', fromR: m.pr, fromC: m.pc, toR: m.nr, toC: m.nc, capPower: m.t.power };
            case 'hop':  return { type: 'hop', fromR: m.pr, fromC: m.pc, toR: m.nr, toC: m.nc };
            case 'push': return { type: 'push', drR: m.pr, drC: m.pc, enemyR: m.er, enemyC: m.ec, destR: m.dest_r, destC: m.dest_c };
            case 'snipe': return { type: 'snipe', robotR: m.pr, robotC: m.pc, targetR: m.nr, targetC: m.nc, spotterR: 0, spotterC: 0 };
            case 'engulf': return { type: 'engulf', r: m.pr, c: m.pc };
            case 'transform': return {
                type: 'transform', wizR: m.pr, wizC: m.pc, isExplosion: m.isExplosion,
                cells: m.cells.map(({ r, c }) => ({ r, c })),
            };
            case 'pyro': return { type: 'pyro', fromR: m.pr, fromC: m.pc, targetR: m.tr, targetC: m.tc };
        }
    }

    // ── getBestMove ──────────────────────────────────────────────────────
    function getBestMove({ state, cpuPlayer, enabledAbilities, timeLimit }) {
        const timeBudget = timeLimit || DEFAULT_TIME_MS;
        initSearch(state, cpuPlayer, enabledAbilities);

        const opponent = cpuPlayer === 1 ? 2 : 1;
        const { captures, quiets } = genMoves(cpuPlayer);
        const allRootMoves = captures.concat(quiets);

        if (allRootMoves.length === 0) {
            return pickUncover(state, cpuPlayer);
        }

        // Build candidates
        const candidates = [];
        if (hasUnknown) {
            candidates.push({ m: null, isTurn: true, value: -INFINITY });
        }
        for (const m of allRootMoves) {
            candidates.push({ m, isTurn: false, value: -INFINITY });
        }

        // Phase 1: single-piece probe (skip if hidden pieces exist)
        let forcedWin = false;
        const myPieces = getPieces(cpuPlayer);
        if (!hasUnknown && myPieces.length > 1) {
            const saved = cpuPlayer === 1 ? p1Pieces.slice() : p2Pieces.slice();
            if (cpuPlayer === 1) p1Pieces = saved.slice(0, 1);
            else p2Pieces = saved.slice(0, 1);

            const t0 = Date.now();
            let d = 0;
            do {
                for (const c of candidates) {
                    if (c.isTurn) {
                        c.value = -negamax(opponent, d, -INFINITY, INFINITY);
                    } else {
                        makeMove(c.m);
                        c.value = -negamax(opponent, d, -INFINITY, INFINITY);
                        unmakeMove(c.m);
                    }
                }
                candidates.sort((a, b) => b.value - a.value);
                d++;
            } while (Date.now() - t0 < timeBudget && d < 30);

            if (candidates[0].value >= INFINITY) forcedWin = true;
            if (cpuPlayer === 1) p1Pieces = saved; else p2Pieces = saved;
        }

        // Phase 2: full search
        if (!forcedWin) {
            const t0 = Date.now();
            let d = 0;
            do {
                for (const c of candidates) {
                    if (c.isTurn) {
                        c.value = -negamax(opponent, d, -INFINITY, INFINITY);
                    } else {
                        makeMove(c.m);
                        c.value = -negamax(opponent, d, -INFINITY, INFINITY);
                        unmakeMove(c.m);
                    }
                }
                candidates.sort((a, b) => b.value - a.value);
                d++;
            } while (Date.now() - t0 < timeBudget && d < 30);

            debugLog(`ClassicAI: depth=${d}, value=${candidates[0].value}, ` +
                     `time=${Date.now() - t0}ms, moves=${candidates.length}`);
        }

        const best = candidates[0];
        if (best.isTurn) return pickUncover(state, cpuPlayer);
        return toGameMove(best.m);
    }

    return { getBestMove };
})();
