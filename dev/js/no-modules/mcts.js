// mcts.js - Monte Carlo Tree Search with Information Set determinization
// "Genius" difficulty — drop-in replacement for minimax getBestMove interface.

const SkillMCTS = (function () {
    'use strict';

    const EXPLORATION_C = 1.41;  // UCB1 exploration constant (√2)
    const DEFAULT_ITERATIONS = 10000;
    const DETERMINIZATIONS = 8; // fewer worlds, deeper trees per world

    // ─── Move Generation (mirrors minimax's getAllMoves) ─────────────────────
    // Uses the same global functions from rules.js.
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
                    for (const { row, col } of getValidMoves(state, r, c)) {
                        const target = state.board[row][col];
                        if (target) {
                            captures.push({ type: 'capture', fromR: r, fromC: c, toR: row, toC: col, capPower: target.power });
                        } else {
                            moves.push({ type: 'move', fromR: r, fromC: c, toR: row, toC: col });
                        }
                    }
                    for (const m of getPushMoves(state, r, c, enabledAbilities))  moves.push(m);
                    for (const m of getHopMoves(state, r, c, enabledAbilities))   moves.push(m);
                    for (const m of getEngulfMoves(state, r, c, enabledAbilities)) {
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
                    for (const m of getSnipeMoves(state, r, c, enabledAbilities))     captures.push(m);
                    for (const m of getPyroMoves(state, r, c, enabledAbilities))      moves.push(m);
                    for (const m of getTransformMoves(state, r, c, enabledAbilities))  moves.push(m);
                }
            }
        }
        captures.sort((a, b) => (b.capPower || 0) - (a.capPower || 0));
        return [...captures, ...moves, ...uncovers];
    }

    // ─── Determinization ─────────────────────────────────────────────────────
    // The AI can see uncovered pieces but not covered ones. For MCTS to reason
    // about hidden information, we "determinize": randomly assign identities to
    // covered cells consistent with what's known, then run a normal perfect-info
    // tree search on that concrete world.
    function determinize(maskedState, cpuPlayer) {
        const s = cloneState(maskedState);

        // Collect covered cells and figure out what pieces are unaccounted for
        const coveredCells = [];
        const seenByPlayer = {};  // player → array of seen piece types

        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (s.covered[r][c]) {
                    coveredCells.push({ r, c });
                } else {
                    const p = s.board[r][c];
                    if (p && p.player !== 0) {
                        if (!seenByPlayer[p.player]) seenByPlayer[p.player] = [];
                        seenByPlayer[p.player].push(p.type);
                    }
                }
            }
        }

        if (coveredCells.length === 0) return s;

        // Build pool of unaccounted pieces per player
        const numPlayers = (typeof gameState !== 'undefined' && gameState.numPlayers) || 2;
        const pool = [];  // flat array of { type, power, player }

        for (let pl = 1; pl <= numPlayers; pl++) {
            const seen = seenByPlayer[pl] || [];
            const remaining = {};
            for (const def of PIECES) {
                remaining[def.type] = def.quantity;
            }
            for (const t of seen) {
                remaining[t]--;
            }
            // The deficit between remaining and covered could include captured pieces.
            // We don't know which are captured vs still covered, so we just use all
            // remaining as the pool and draw from it.
            for (const def of PIECES) {
                for (let i = 0; i < Math.max(0, remaining[def.type]); i++) {
                    pool.push({ type: def.type, power: def.power, player: pl });
                }
            }
        }

        // Shuffle pool and assign to covered cells
        shuffle(pool);

        for (let i = 0; i < coveredCells.length; i++) {
            const { r, c } = coveredCells[i];
            if (i < pool.length) {
                s.board[r][c] = { ...pool[i], burning: false };
            } else {
                // More covered cells than pool pieces — some were captured.
                // Fill with a dummy that will be "uncovered" as empty.
                s.board[r][c] = null;
                s.covered[r][c] = false;
            }
        }

        return s;
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // ─── MCTS Tree Node ──────────────────────────────────────────────────────
    // Progressive widening: max children = PW_C * visits^PW_ALPHA.
    // At 1 visit: ~3 children. At 10: ~7. At 50: ~12. At 200: ~20.
    // This focuses the search budget on promising moves first, gradually
    // widening to explore alternatives as confidence grows.
    const PW_C = 3;
    const PW_ALPHA = 0.35;

    class MCTSNode {
        constructor(state, player, enabledAbilities, parent, move, depth) {
            this.state = state;
            this.player = player;
            this.enabledAbilities = enabledAbilities;
            this.parent = parent;
            this.move = move;
            this.depth = depth || 0;
            this.children = [];
            this.allMoves = null;           // full sorted move list (lazy)
            this.expandIdx = 0;             // how many moves we've expanded so far
            this.visits = 0;
            this.wins = 0;
        }

        // Lazily generate and sort all moves — captures first (by power),
        // then abilities/moves, then uncovers. Priority order ensures
        // progressive widening tries the best moves first.
        _ensureMoves() {
            if (this.allMoves === null) {
                this.allMoves = getAllMoves(this.state, this.player, this.enabledAbilities);
            }
        }

        // Max children allowed given current visit count (progressive widening)
        maxChildren() {
            return Math.ceil(PW_C * Math.pow(Math.max(1, this.visits), PW_ALPHA));
        }

        // Can we expand another child? Yes if we haven't hit the widening
        // limit AND there are untried moves remaining.
        canExpand() {
            this._ensureMoves();
            return this.expandIdx < this.allMoves.length &&
                   this.children.length < this.maxChildren();
        }

        isFullyExpanded() {
            this._ensureMoves();
            // Fully expanded when we've either tried all moves or hit the
            // widening cap and have enough visits to not widen further yet.
            return !this.canExpand();
        }

        isTerminal() {
            if (this.state.covered.some(row => row.some(v => v))) return false;
            let p1 = 0, p2 = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = this.state.board[r][c];
                    if (!p) continue;
                    if (p.player === 1) p1++;
                    else if (p.player === 2) p2++;
                }
            return p1 === 0 || p2 === 0;
        }

        getWinner() {
            let p1 = 0, p2 = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = this.state.board[r][c];
                    if (!p) continue;
                    if (p.player === 1) p1++;
                    else if (p.player === 2) p2++;
                }
            if (p1 === 0) return 2;
            if (p2 === 0) return 1;
            return 0;
        }

        // UCB1 selection
        bestChild(cpuPlayer) {
            let best = null;
            let bestVal = -Infinity;
            const lnParent = Math.log(this.visits);
            for (const child of this.children) {
                const winRate = child.wins / child.visits;
                const exploit = this.player === cpuPlayer ? winRate : (1 - winRate);
                const explore = EXPLORATION_C * Math.sqrt(lnParent / child.visits);
                const ucb = exploit + explore;
                if (ucb > bestVal) {
                    bestVal = ucb;
                    best = child;
                }
            }
            return best;
        }

        // Expand: take the next move in priority order
        expand(numPlayers) {
            this._ensureMoves();
            const move = this.allMoves[this.expandIdx++];
            const newState = applyMoveToState(this.state, move);
            const nextPlayer = (this.player % numPlayers) + 1;
            const child = new MCTSNode(newState, nextPlayer, this.enabledAbilities, this, move, this.depth + 1);
            this.children.push(child);
            return child;
        }
    }

    // ─── Leaf Evaluation ───────────────────────────────────────────────────
    // Lean eval with threat-scarcity valuation: a piece is worth more when
    // the opponent has fewer pieces that can capture it. This is not a
    // positional heuristic — it's a fundamental truth about piece value.
    // Returns a value in [0, 1] for backpropagation.
    function evaluateLeaf(state, cpuPlayer) {
        // First pass: collect visible pieces by player
        let hasCovered = false;
        const cpuPieces = [];  // { type, power, burning }
        const opPieces  = [];

        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                if (!p) continue;
                if (state.covered[r][c]) { hasCovered = true; continue; }
                if (p.player === cpuPlayer) cpuPieces.push(p);
                else opPieces.push(p);
            }
        }

        // Terminal: one side wiped out
        if (!hasCovered) {
            if (cpuPieces.length === 0) return 0;
            if (opPieces.length  === 0) return 1;
        }

        // Threat-scarcity valuation: a piece's effective value depends on
        // how many enemy pieces can capture it.
        // - Robot with no enemy robot/dragon → nearly invincible → high value
        // - Dragon with no enemy mice → invincible → high value
        // - Low piece with many threats → base value only
        const cpuValue = pieceSetValue(cpuPieces, opPieces);
        const opValue  = pieceSetValue(opPieces, cpuPieces);

        const total = cpuValue + opValue;
        if (total === 0) return 0.5;
        return cpuValue / total;
    }

    // Calculate total value of a set of pieces given the threats from enemies.
    function pieceSetValue(ownPieces, enemyPieces) {
        // Count enemy threats by category
        let enemyHasMouse = false, enemyHasDragon = false;
        const enemyMaxPower = enemyPieces.reduce((max, p) => {
            if (p.type === 'mouse') enemyHasMouse = true;
            if (p.type === 'dragon') enemyHasDragon = true;
            return Math.max(max, p.burning ? p.power : p.power);
        }, 0);

        let totalValue = 0;
        for (const p of ownPieces) {
            const base = p.power * (p.burning ? 0.7 : 1);
            let threats = 0;

            if (p.type === 'dragon') {
                // Dragon is capturable by: mice (special), equal dragon
                if (enemyHasMouse) threats++;
                if (enemyHasDragon) threats++;
            } else if (p.type === 'mouse') {
                // Mice are capturable by everything except dragon
                // (dragon can't capture mouse). Low-value, many threats.
                threats = enemyPieces.filter(e =>
                    e.type !== 'dragon' || e.burning  // burning dragon CAN capture mice
                ).length;
            } else {
                // Normal capture: anything with power >= this piece's power
                threats = enemyPieces.filter(e => {
                    if (e.type === 'mouse' && p.type === 'dragon') return true;  // mouse kills dragon
                    return e.power >= p.power;
                }).length;
            }

            // Scale: 0 threats → 2.5x value, 1 threat → 1.5x, 2+ → 1x
            const scarcity = threats === 0 ? 2.5 : threats === 1 ? 1.5 : 1.0;
            totalValue += base * scarcity;
        }
        return totalValue;
    }

    // ─── MCTS Search (single determinization) ───────────────────────────────
    function mctsSearch(rootState, cpuPlayer, enabledAbilities, iterations, numPlayers) {
        const root = new MCTSNode(rootState, cpuPlayer, enabledAbilities, null, null);

        for (let i = 0; i < iterations; i++) {
            // 1. Selection — walk down the tree picking best UCB1 children
            let node = root;
            while (!node.isTerminal() && node.isFullyExpanded() && node.children.length > 0) {
                node = node.bestChild(cpuPlayer);
            }

            // 2. Expansion — if not terminal and has untried moves, expand one
            if (!node.isTerminal() && !node.isFullyExpanded()) {
                node = node.expand(numPlayers);
            }

            // 3. Evaluation — use minimax eval instead of random rollout
            let result;
            if (node.isTerminal()) {
                result = node.getWinner() === cpuPlayer ? 1 : 0;
            } else {
                result = evaluateLeaf(node.state, cpuPlayer);
            }

            // 4. Backpropagation — update visits/wins up the tree
            let n = node;
            while (n !== null) {
                n.visits++;
                n.wins += result;
                n = n.parent;
            }
        }

        return root;
    }

    // ─── Tactical Override ─────────────────────────────────────────────────
    // Some captures are so obviously correct that we don't need MCTS to
    // discover them. Check for no-brainer captures before running the tree.
    function tacticalOverride(state, cpuPlayer, enabledAbilities) {
        const moves = getAllMoves(state, cpuPlayer, enabledAbilities);
        const captures = moves.filter(m => m.type === 'capture' || m.type === 'snipe');
        if (captures.length === 0) return null;

        // Mouse capturing unburning dragon — always take it
        for (const m of captures) {
            if (m.type !== 'capture') continue;
            const attacker = state.board[m.fromR][m.fromC];
            const target = state.board[m.toR][m.toC];
            if (attacker && attacker.type === 'mouse' && target && target.type === 'dragon' && !target.burning) {
                debugLog('MCTS tactical override: mouse captures dragon');
                return m;
            }
        }

        // High-value free capture: if we can capture a piece and the opponent
        // can't immediately recapture on that square, take it.
        // Check the top capture (sorted by power) for safety.
        const best = captures[0];
        if (best.type === 'capture' && (best.capPower || 0) >= 3) {
            const toR = best.toR, toC = best.toC;
            const attacker = state.board[best.fromR][best.fromC];
            // Check if any enemy piece can recapture on that square
            let canRecapture = false;
            for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                const nr = toR + dr, nc = toC + dc;
                if (!inBounds(nr, nc)) continue;
                const p = state.board[nr][nc];
                if (p && p.player !== cpuPlayer && p.player !== 0 && !state.covered[nr][nc]) {
                    if (canCapture(p, attacker)) { canRecapture = true; break; }
                }
            }
            if (!canRecapture) {
                debugLog(`MCTS tactical override: free capture of power ${best.capPower}`);
                return best;
            }
        }

        return null;
    }

    // ─── Information Set MCTS (main entry point) ─────────────────────────────
    // Runs multiple MCTS trees on different determinizations of the hidden state,
    // then aggregates move scores across all trees.
    function getBestMove({ state, cpuPlayer, enabledAbilities, iterations, determinizations }) {
        const numPlayers = (typeof gameState !== 'undefined' && gameState.numPlayers) || 2;

        // Check for obvious tactical captures before running full search
        const tactical = tacticalOverride(state, cpuPlayer, enabledAbilities);
        if (tactical) return tactical;

        const iters = iterations || DEFAULT_ITERATIONS;
        const numDet = determinizations || DETERMINIZATIONS;

        // Count covered cells to decide if determinization is needed
        let coveredCount = 0;
        for (let r = 0; r < BOARD_ROWS; r++)
            for (let c = 0; c < BOARD_COLS; c++)
                if (state.board[r][c] && state.covered[r][c]) coveredCount++;

        // Scale iterations: more when board is open (cheaper evals, critical tactics).
        // With lean material eval, each iteration is very fast — push hard.
        const scaledIters = coveredCount > 16 ? Math.floor(iters * 0.5)
                          : coveredCount > 8  ? iters
                          : coveredCount > 0  ? Math.floor(iters * 1.5)
                          : Math.floor(iters * 2);  // endgame: perfect info, go deep

        // If no covered cells, single determinization suffices (perfect info)
        const actualDet = coveredCount === 0 ? 1 : numDet;

        debugLog(`MCTS: iters=${scaledIters}, determinizations=${actualDet}, covered=${coveredCount}`);

        // Aggregate move scores across determinizations
        // Key: serialized move → { totalVisits, totalWins, move }
        const moveStats = new Map();

        for (let d = 0; d < actualDet; d++) {
            const detState = coveredCount > 0 ? determinize(state, cpuPlayer) : state;
            const root = mctsSearch(detState, cpuPlayer, enabledAbilities, scaledIters, numPlayers);

            for (const child of root.children) {
                const key = moveKey(child.move);
                const existing = moveStats.get(key);
                if (existing) {
                    existing.totalVisits += child.visits;
                    existing.totalWins += child.wins;
                } else {
                    moveStats.set(key, {
                        move: child.move,
                        totalVisits: child.visits,
                        totalWins: child.wins,
                    });
                }
            }
        }

        // Pick the move with the most total visits (robust child selection)
        let bestMove = null;
        let bestVisits = -1;
        for (const entry of moveStats.values()) {
            if (entry.totalVisits > bestVisits) {
                bestVisits = entry.totalVisits;
                bestMove = entry.move;
            }
        }

        if (bestMove) {
            const stats = moveStats.get(moveKey(bestMove));
            const winRate = (stats.totalWins / stats.totalVisits * 100).toFixed(1);
            debugLog(`MCTS chose: ${bestMove.type} visits=${bestVisits} winRate=${winRate}%`);
        }

        return bestMove;
    }

    // Serialize a move to a string key for aggregation across determinizations
    function moveKey(move) {
        switch (move.type) {
            case 'uncover':   return `u:${move.r},${move.c}`;
            case 'move':      return `m:${move.fromR},${move.fromC}-${move.toR},${move.toC}`;
            case 'capture':   return `c:${move.fromR},${move.fromC}-${move.toR},${move.toC}`;
            case 'hop':       return `h:${move.fromR},${move.fromC}-${move.toR},${move.toC}`;
            case 'push':      return `p:${move.drR},${move.drC}-${move.enemyR},${move.enemyC}-${move.destR},${move.destC}`;
            case 'engulf':    return `e:${move.r},${move.c}`;
            case 'snipe':     return `s:${move.robotR},${move.robotC}-${move.targetR},${move.targetC}`;
            case 'pyro':      return `y:${move.fromR},${move.fromC}-${move.targetR},${move.targetC}`;
            case 'transform': return `t:${move.wizR},${move.wizC}-${move.cells.map(c => `${c.r},${c.c}`).join('/')}`;
            default:          return `?:${JSON.stringify(move)}`;
        }
    }

    return { getBestMove };
})();
