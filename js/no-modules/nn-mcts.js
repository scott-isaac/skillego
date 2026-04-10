// nn-mcts.js — Neural Network-guided MCTS for "Genius" difficulty.
// Uses a TF.js model (trained by alphazero/) for policy priors + value evaluation.
// Falls back to the vanilla SkillMCTS when no model is loaded.
//
// Depends on: tf.js (TensorFlow.js), rules.js, constants.js, mcts.js

const SkillNNMCTS = (function () {
    'use strict';

    let _model = null;        // TF.js LayersModel
    let _modelReady = false;

    // ── Action space constants (must match Python config.py exactly) ──────
    const NUM_CELLS = BOARD_ROWS * BOARD_COLS;  // 36
    const DIR_IDX = { '-1,0': 0, '0,1': 1, '1,0': 2, '0,-1': 3 }; // N,E,S,W

    const PLANE_MOVE = 0;
    const PLANE_UNCOVER = 4;
    const PLANE_HOP = 5;
    const PLANE_PUSH = 9;
    const PLANE_ENGULF = 13;
    const PLANE_TRANSFORM_LINE = 14;
    const PLANE_TRANSFORM_EXPLODE = 18;
    const PLANE_SNIPE = 19;
    const PLANE_PYRO = 23;

    const ACTION_SPACE_SIZE = 27 * NUM_CELLS;  // 972

    // Ability IDs in encoding order (must match Python)
    const ABILITY_IDS = ['push', 'hop', 'engulf', 'transform', 'snipe', 'pyromania'];

    const TYPE_TO_IDX = { mouse: 0, cat: 1, dog: 2, wizard: 3, robot: 4, dragon: 5 };

    // PUCT constants
    const CPUCT = 1.5;
    const DEFAULT_SIMS = 200;
    const DEFAULT_DETS = 4;

    // ── Model Loading ────────────────────────────────────────────────────
    async function loadModel(url) {
        if (typeof tf === 'undefined') {
            console.warn('NN-MCTS: TensorFlow.js not loaded, skipping model load');
            return false;
        }
        try {
            // Check for trained-model marker (export.py writes this).
            // Without it, the model is untrained and we should fall back to vanilla MCTS.
            const markerUrl = url.replace('model.json', 'trained.json');
            const markerResp = await fetch(markerUrl);
            if (!markerResp.ok) {
                console.log('NN-MCTS: No trained.json marker found — model not yet trained, skipping');
                return false;
            }
            const marker = await markerResp.json();
            console.log(`NN-MCTS: Found trained model (iteration ${marker.iteration || '?'})`);

            // Try loading as a graph model first (SavedModel export), then layers model
            try {
                _model = await tf.loadGraphModel(url);
            } catch {
                _model = await tf.loadLayersModel(url);
            }
            // Warm up with dummy input
            const dummy = tf.zeros([1, BOARD_ROWS, BOARD_COLS, 24]);
            const out = _model.predict(dummy);
            if (Array.isArray(out)) out.forEach(t => t.dispose());
            else out.dispose();
            dummy.dispose();
            _modelReady = true;
            console.log('NN-MCTS: Model loaded and ready');
            return true;
        } catch (e) {
            console.warn('NN-MCTS: Failed to load model:', e.message);
            _modelReady = false;
            return false;
        }
    }

    function isModelReady() { return _modelReady; }

    // ── State Encoding (matches Python encode_state exactly) ─────────────
    function encodeState(state, cpuPlayer, enabledAbilities) {
        // Returns Float32Array of shape [6, 6, 24] (channels-last, row-major)
        const H = BOARD_ROWS, W = BOARD_COLS, C = 24;
        const tensor = new Float32Array(H * W * C);
        const opponent = cpuPlayer === 1 ? 2 : (cpuPlayer === 2 ? 1 : (3 - cpuPlayer));

        for (let r = 0; r < H; r++) {
            for (let c = 0; c < W; c++) {
                const base = (r * W + c) * C;
                const piece = state.board[r][c];
                if (!piece) {
                    tensor[base + 14] = 1.0;  // empty
                    continue;
                }

                if (piece.player === cpuPlayer) {
                    // Own piece — we know type even if covered
                    const idx = TYPE_TO_IDX[piece.type];
                    if (idx !== undefined) tensor[base + idx] = 1.0;
                    if (state.covered[r][c]) tensor[base + 12] = 1.0;
                    if (piece.burning) tensor[base + 15] = piece.power / 6.0;
                } else if (piece.player !== 0) {
                    // Opponent piece
                    if (state.covered[r][c]) {
                        tensor[base + 13] = 1.0;  // opponent covered
                    } else {
                        const idx = TYPE_TO_IDX[piece.type];
                        if (idx !== undefined) tensor[base + 6 + idx] = 1.0;
                        if (piece.burning) tensor[base + 16] = piece.power / 6.0;
                    }
                }

                // Bias
                tensor[base + 17] = 1.0;
            }
        }

        // Fill bias for empty cells too
        for (let r = 0; r < H; r++)
            for (let c = 0; c < W; c++)
                tensor[(r * W + c) * C + 17] = 1.0;

        // Ability flags (planes 18-23)
        for (let i = 0; i < ABILITY_IDS.length; i++) {
            if (enabledAbilities.has(ABILITY_IDS[i])) {
                for (let r = 0; r < H; r++)
                    for (let c = 0; c < W; c++)
                        tensor[(r * W + c) * C + 18 + i] = 1.0;
            }
        }

        return tensor;
    }

    // ── Move → Action Index (matches Python move_to_action exactly) ──────
    function moveToAction(move) {
        const cellIdx = (r, c) => r * BOARD_COLS + c;
        const dirIdx = (dr, dc) => DIR_IDX[`${dr},${dc}`];

        switch (move.type) {
            case 'move':
            case 'capture': {
                const d = dirIdx(move.toR - move.fromR, move.toC - move.fromC);
                return (PLANE_MOVE + d) * NUM_CELLS + cellIdx(move.fromR, move.fromC);
            }
            case 'uncover':
                return PLANE_UNCOVER * NUM_CELLS + cellIdx(move.r, move.c);
            case 'hop': {
                const dr = (move.toR - move.fromR) / 2, dc = (move.toC - move.fromC) / 2;
                const d = dirIdx(dr, dc);
                return (PLANE_HOP + d) * NUM_CELLS + cellIdx(move.fromR, move.fromC);
            }
            case 'push': {
                const d = dirIdx(move.enemyR - move.drR, move.enemyC - move.drC);
                return (PLANE_PUSH + d) * NUM_CELLS + cellIdx(move.drR, move.drC);
            }
            case 'engulf':
                return PLANE_ENGULF * NUM_CELLS + cellIdx(move.r, move.c);
            case 'transform': {
                if (move.isExplosion) {
                    return PLANE_TRANSFORM_EXPLODE * NUM_CELLS + cellIdx(move.wizR, move.wizC);
                }
                const cell1 = move.cells[1];
                const d = dirIdx(cell1.r - move.wizR, cell1.c - move.wizC);
                return (PLANE_TRANSFORM_LINE + d) * NUM_CELLS + cellIdx(move.wizR, move.wizC);
            }
            case 'snipe': {
                const dr = move.targetR === move.robotR ? 0 : (move.targetR > move.robotR ? 1 : -1);
                const dc = move.targetC === move.robotC ? 0 : (move.targetC > move.robotC ? 1 : -1);
                const d = dirIdx(dr, dc);
                return (PLANE_SNIPE + d) * NUM_CELLS + cellIdx(move.robotR, move.robotC);
            }
            case 'pyro': {
                const d = dirIdx(move.targetR - move.fromR, move.targetC - move.fromC);
                return (PLANE_PYRO + d) * NUM_CELLS + cellIdx(move.fromR, move.fromC);
            }
            default:
                return -1;
        }
    }

    // ── NN Inference ─────────────────────────────────────────────────────
    function predict(stateArray) {
        // stateArray: Float32Array of shape [H*W*C]
        // Returns { policy: Float32Array(972), value: number }
        const input = tf.tensor4d(stateArray, [1, BOARD_ROWS, BOARD_COLS, 24]);
        const [policyLogits, valueTensor] = _model.predict(input);
        const policy = policyLogits.dataSync();   // Float32Array(972)
        const value = valueTensor.dataSync()[0];   // scalar
        input.dispose();
        policyLogits.dispose();
        valueTensor.dispose();
        return { policy, value };
    }

    // ── NN-Guided MCTS Node ──────────────────────────────────────────────
    class NNNode {
        constructor(state, player, abilities, parent, move, actionIdx, prior) {
            this.state = state;
            this.player = player;
            this.abilities = abilities;
            this.parent = parent;
            this.move = move;
            this.actionIdx = actionIdx;
            this.children = [];
            this.visitCount = 0;
            this.valueSum = 0;
            this.prior = prior || 0;
            this._expanded = false;
        }

        qValue() {
            return this.visitCount === 0 ? 0 : this.valueSum / this.visitCount;
        }

        isTerminal() {
            if (this.state.covered.some(row => row.some(v => v))) return false;
            let p1 = 0, p2 = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = this.state.board[r][c];
                    if (!p) continue;
                    if (p.player === 1) p1++; else if (p.player === 2) p2++;
                }
            return p1 === 0 || p2 === 0;
        }

        getWinner() {
            let p1 = 0, p2 = 0;
            for (let r = 0; r < BOARD_ROWS; r++)
                for (let c = 0; c < BOARD_COLS; c++) {
                    const p = this.state.board[r][c];
                    if (!p) continue;
                    if (p.player === 1) p1++; else if (p.player === 2) p2++;
                }
            if (p1 === 0) return 2;
            if (p2 === 0) return 1;
            return 0;
        }
    }

    // ── PUCT Selection ───────────────────────────────────────────────────
    function selectChild(node, rootPlayer) {
        const sqrtParent = Math.sqrt(node.visitCount);
        let bestScore = -Infinity;
        let bestChild = null;

        for (const child of node.children) {
            const q = child.visitCount === 0 ? 0 : child.valueSum / child.visitCount;
            // Flip Q for opponent nodes
            const exploitQ = node.player === rootPlayer ? q : -q;
            const explore = CPUCT * child.prior * sqrtParent / (1 + child.visitCount);
            const score = exploitQ + explore;
            if (score > bestScore) {
                bestScore = score;
                bestChild = child;
            }
        }
        return bestChild;
    }

    // ── Expand Node Using NN ─────────────────────────────────────────────
    function expandNode(node, rootPlayer) {
        const stateArray = encodeState(node.state, node.player, node.abilities);
        const { policy: policyLogits, value } = predict(stateArray);

        // Value from current player's perspective → convert to root's perspective
        const nodeValue = node.player === rootPlayer ? value : -value;

        // Get legal moves and compute masked softmax
        const allMoves = getAllMoves(node.state, node.player, node.abilities);
        if (allMoves.length === 0) {
            node._expanded = true;
            return nodeValue;
        }

        // Mask + softmax
        let maxLogit = -Infinity;
        const moveActions = [];
        for (const m of allMoves) {
            const a = moveToAction(m);
            if (a >= 0) {
                moveActions.push({ move: m, action: a, logit: policyLogits[a] });
                if (policyLogits[a] > maxLogit) maxLogit = policyLogits[a];
            }
        }

        let sumExp = 0;
        for (const ma of moveActions) {
            ma.expLogit = Math.exp(ma.logit - maxLogit);
            sumExp += ma.expLogit;
        }

        const nextPlayer = node.player === 1 ? 2 : 1;
        for (const ma of moveActions) {
            const prior = sumExp > 0 ? ma.expLogit / sumExp : 1 / moveActions.length;
            const childState = applyMoveToState(node.state, ma.move);
            const child = new NNNode(childState, nextPlayer, node.abilities,
                                     node, ma.move, ma.action, prior);
            node.children.push(child);
        }

        node._expanded = true;
        return nodeValue;
    }

    // ── Backpropagation ──────────────────────────────────────────────────
    function backpropagate(node, value) {
        while (node !== null) {
            node.visitCount++;
            node.valueSum += value;
            node = node.parent;
        }
    }

    // ── NN-Guided MCTS Search ────────────────────────────────────────────
    function nnMctsSearch(rootState, cpuPlayer, abilities, numSims) {
        const root = new NNNode(rootState, cpuPlayer, abilities, null, null, -1, 0);
        expandNode(root, cpuPlayer);

        // Dirichlet noise at root for exploration variety
        if (root.children.length > 0) {
            const alpha = 0.3;
            const eps = 0.25;
            const noise = dirichletNoise(root.children.length, alpha);
            for (let i = 0; i < root.children.length; i++) {
                root.children[i].prior = (1 - eps) * root.children[i].prior + eps * noise[i];
            }
        }

        for (let sim = 0; sim < numSims; sim++) {
            let node = root;

            // Selection
            while (node._expanded && !node.isTerminal() && node.children.length > 0) {
                node = selectChild(node, cpuPlayer);
            }

            // Expansion + Evaluation
            let value;
            if (node.isTerminal()) {
                const winner = node.getWinner();
                value = winner === cpuPlayer ? 1 : (winner === 0 ? 0 : -1);
            } else if (!node._expanded) {
                value = expandNode(node, cpuPlayer);
            } else {
                value = -1;  // no children, treat as loss
            }

            // Backpropagation
            backpropagate(node, value);
        }

        return root;
    }

    function dirichletNoise(n, alpha) {
        // Simple Dirichlet via gamma distribution approximation
        const samples = new Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
            // Gamma(alpha, 1) approximation using Marsaglia method
            samples[i] = gammaRandom(alpha);
            sum += samples[i];
        }
        for (let i = 0; i < n; i++) samples[i] /= sum;
        return samples;
    }

    function gammaRandom(alpha) {
        // Marsaglia & Tsang's method for alpha >= 1
        // For alpha < 1: gamma(alpha) = gamma(alpha+1) * U^(1/alpha)
        if (alpha < 1) {
            return gammaRandom(alpha + 1) * Math.pow(Math.random(), 1 / alpha);
        }
        const d = alpha - 1/3;
        const c = 1 / Math.sqrt(9 * d);
        while (true) {
            let x, v;
            do {
                x = normalRandom();
                v = 1 + c * x;
            } while (v <= 0);
            v = v * v * v;
            const u = Math.random();
            if (u < 1 - 0.0331 * (x*x) * (x*x)) return d * v;
            if (Math.log(u) < 0.5 * x*x + d * (1 - v + Math.log(v))) return d * v;
        }
    }

    function normalRandom() {
        // Box-Muller transform
        const u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    // ── Main Entry Point ─────────────────────────────────────────────────
    function getBestMove({ state, cpuPlayer, enabledAbilities, iterations, determinizations }) {
        if (!_modelReady) {
            // Fall back to vanilla MCTS
            return SkillMCTS.getBestMove({ state, cpuPlayer, enabledAbilities, iterations, determinizations });
        }

        const numPlayers = (typeof gameState !== 'undefined' && gameState.numPlayers) || 2;

        // Tactical override (same as vanilla MCTS)
        const allMoves = getAllMoves(state, cpuPlayer, enabledAbilities);
        const captures = allMoves.filter(m => m.type === 'capture' || m.type === 'snipe');

        // Mouse capturing unburning dragon — always
        for (const m of captures) {
            if (m.type !== 'capture') continue;
            const attacker = state.board[m.fromR][m.fromC];
            const target = state.board[m.toR][m.toC];
            if (attacker && attacker.type === 'mouse' && target && target.type === 'dragon' && !target.burning) {
                debugLog('NN-MCTS tactical override: mouse captures dragon');
                return m;
            }
        }

        const numSims = iterations || DEFAULT_SIMS;
        const numDet = determinizations || DEFAULT_DETS;

        // Count covered
        let coveredCount = 0;
        for (let r = 0; r < BOARD_ROWS; r++)
            for (let c = 0; c < BOARD_COLS; c++)
                if (state.board[r][c] && state.covered[r][c]) coveredCount++;

        const actualDet = coveredCount === 0 ? 1 : numDet;
        const scaledSims = coveredCount > 16 ? Math.floor(numSims * 0.5)
                         : coveredCount > 8  ? numSims
                         : coveredCount > 0  ? Math.floor(numSims * 1.5)
                         : Math.floor(numSims * 2);

        debugLog(`NN-MCTS: sims=${scaledSims}, dets=${actualDet}, covered=${coveredCount}`);

        // Aggregate across determinizations
        const moveStats = new Map();

        for (let d = 0; d < actualDet; d++) {
            const detState = coveredCount > 0 ? determinize(state, cpuPlayer) : state;
            const root = nnMctsSearch(detState, cpuPlayer, enabledAbilities, scaledSims);

            for (const child of root.children) {
                const key = moveKey(child.move);
                const existing = moveStats.get(key);
                if (existing) {
                    existing.totalVisits += child.visitCount;
                } else {
                    moveStats.set(key, { move: child.move, totalVisits: child.visitCount });
                }
            }
        }

        // Pick most-visited move
        let bestMove = null;
        let bestVisits = -1;
        for (const entry of moveStats.values()) {
            if (entry.totalVisits > bestVisits) {
                bestVisits = entry.totalVisits;
                bestMove = entry.move;
            }
        }

        if (bestMove) {
            debugLog(`NN-MCTS chose: ${bestMove.type} visits=${bestVisits}`);
        }

        return bestMove;
    }

    // Reuse moveKey from SkillMCTS (same module scope via rules.js globals)
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

    return { loadModel, isModelReady, getBestMove, encodeState, moveToAction };
})();
