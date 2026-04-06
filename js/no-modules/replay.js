// replay.js — Game log parser and visual replay state machine.

const GameReplay = (function () {
    'use strict';

    let _states  = [];   // {board, covered} per step; index 0 = initial
    let _moves   = [];   // parsed move objects
    let _stepIdx = 0;
    let _active  = false;

    // ── Parsing ───────────────────────────────────────────────────────────────

    const LETTER_TYPE = { W: 'wizard', M: 'mouse', R: 'robot', C: 'cat' };

    function pieceFromCode(code) {
        if (!code || code === '.') return null;
        const player = +code.slice(-1);
        const inner  = code.slice(0, -2);          // e.g. "W4", "D3", "D6"
        const letter = inner[0];
        const power  = +inner.slice(1);
        const type   = letter === 'D' ? (power === 6 ? 'dragon' : 'dog')
                                      : (LETTER_TYPE[letter] || 'unknown');
        return { type, power, player, burning: false };
    }

    function parseInitialBoard(lines) {
        const board = Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
        for (const line of lines) {
            const m = line.match(/^(\d+)\s+(.+)/);
            if (!m) continue;
            const row    = +m[1];
            const tokens = m[2].trim().split(/\s+/);
            tokens.forEach((code, col) => {
                if (col < BOARD_COLS) board[row][col] = pieceFromCode(code);
            });
        }
        return board;
    }

    function parseMoveLine(line) {
        const hdr = line.match(/^T(\d+) P(\d+): (.+)$/);
        if (!hdr) return null;
        const turn = +hdr[1], player = +hdr[2], act = hdr[3].trim();
        let m;

        if ((m = act.match(/^UNCOVER \((\d+),(\d+)\)/)))
            return { turn, player, type: 'uncover', r: +m[1], c: +m[2], label: act };

        if ((m = act.match(/^dragon\[\d+\] ENGULFS \((\d+),(\d+)\)/)))
            return { turn, player, type: 'engulf', r: +m[1], c: +m[2], label: act };

        if ((m = act.match(/^\S+\[\d+\] HOP \((\d+),(\d+)\)[^(]+\((\d+),(\d+)\)/)))
            return { turn, player, type: 'hop', fromR: +m[1], fromC: +m[2], toR: +m[3], toC: +m[4], label: act };

        if ((m = act.match(/^wizard\[\d+\] \((\d+),(\d+)\) TRANSFORMS[^(]+mice at (.+)$/))) {
            const cells = [...m[3].matchAll(/\((\d+),(\d+)\)/g)].map(mm => ({ r: +mm[1], c: +mm[2] }));
            return { turn, player, type: 'transform', wizR: +m[1], wizC: +m[2], cells, label: act };
        }

        if ((m = act.match(/^robot\[\d+\] \((\d+),(\d+)\) SNIPES \S+ \((\d+),(\d+)\)/)))
            return { turn, player, type: 'snipe', robotR: +m[1], robotC: +m[2], targetR: +m[3], targetC: +m[4], label: act };

        if ((m = act.match(/^burning \((\d+),(\d+)\) IGNITES \S+ \((\d+),(\d+)\)/)))
            return { turn, player, type: 'pyro', fromR: +m[1], fromC: +m[2], targetR: +m[3], targetC: +m[4], label: act };

        if ((m = act.match(/^dragon\[\d+\] PUSHES \S+ \((\d+),(\d+)\)[^(]+\((\d+),(\d+)\)/)))
            return { turn, player, type: 'push', enemyR: +m[1], enemyC: +m[2], destR: +m[3], destC: +m[4], label: act };

        if ((m = act.match(/^\S+\[\d+\] \((\d+),(\d+)\)[^(]+\((\d+),(\d+)\)/)))
            return { turn, player, type: act.includes('CAPTURES') ? 'capture' : 'move',
                     fromR: +m[1], fromC: +m[2], toR: +m[3], toC: +m[4], label: act };

        return null;
    }

    // ── State application ─────────────────────────────────────────────────────

    function cloneState(state) {
        return {
            board:   state.board.map(row => row.map(p => p ? { ...p } : null)),
            covered: state.covered.map(row => [...row]),
        };
    }

    function applyMoveToReplay(state, move) {
        const s = cloneState(state);
        switch (move.type) {
            case 'uncover':
                s.covered[move.r][move.c] = false;
                break;
            case 'move':
            case 'capture': {
                const piece = s.board[move.fromR]?.[move.fromC];
                if (!piece) break;
                s.board[move.toR][move.toC] = piece;
                s.board[move.fromR][move.fromC] = null;
                s.covered[move.toR][move.toC] = false;
                if (piece.burning) {
                    piece.power--;
                    if (piece.power <= 0) s.board[move.toR][move.toC] = null;
                    else if (typeof BURN_LEVEL !== 'undefined') piece.type = BURN_LEVEL[piece.power].type;
                }
                break;
            }
            case 'hop': {
                const piece = s.board[move.fromR]?.[move.fromC];
                if (!piece) break;
                s.board[move.toR][move.toC] = piece;
                s.board[move.fromR][move.fromC] = null;
                s.covered[move.toR][move.toC] = false;
                break;
            }
            case 'engulf':
                if (s.board[move.r]?.[move.c]) s.board[move.r][move.c].burning = true;
                break;
            case 'transform': {
                const player = s.board[move.wizR]?.[move.wizC]?.player;
                s.board[move.wizR][move.wizC] = null;
                if (player !== undefined) {
                    for (const { r, c } of move.cells) {
                        if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS && !s.board[r][c]) {
                            s.board[r][c] = { type: 'mouse', power: 1, player, burning: false };
                            s.covered[r][c] = false;
                        }
                    }
                }
                break;
            }
            case 'snipe': {
                const piece = s.board[move.robotR]?.[move.robotC];
                if (!piece) break;
                s.board[move.targetR][move.targetC] = piece;
                s.board[move.robotR][move.robotC] = null;
                s.covered[move.targetR][move.targetC] = false;
                break;
            }
            case 'pyro': {
                if (s.board[move.targetR]?.[move.targetC]) s.board[move.targetR][move.targetC].burning = true;
                const burner = s.board[move.fromR]?.[move.fromC];
                if (burner) {
                    burner.power--;
                    if (burner.power <= 0) s.board[move.fromR][move.fromC] = null;
                    else if (typeof BURN_LEVEL !== 'undefined') burner.type = BURN_LEVEL[burner.power].type;
                }
                break;
            }
            case 'push': {
                const piece = s.board[move.enemyR]?.[move.enemyC];
                if (!piece) break;
                s.board[move.destR][move.destC] = piece;
                s.board[move.enemyR][move.enemyC] = null;
                s.covered[move.destR][move.destC] = false;
                break;
            }
        }
        return s;
    }

    // ── DOM ───────────────────────────────────────────────────────────────────

    function initBoard() {
        const boardEl = document.getElementById('board');
        if (!boardEl) return;
        boardEl.innerHTML = '';
        for (let row = 0; row < BOARD_ROWS; row++) {
            for (let col = 0; col < BOARD_COLS; col++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.dataset.row  = row;
                cell.dataset.col  = col;
                cell.dataset.tile = String(Math.floor(Math.random() * 3) + 1);
                boardEl.appendChild(cell);
            }
        }
    }

    function renderStep(idx) {
        const state = _states[idx];
        if (!state) return;

        // Clear any analysis overlay from a previous analyze call
        clearAnalysisSvg();
        const analyzeBtn = document.getElementById('replay-analyze');

        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const el = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                if (el) renderCell(el, state.board[r][c], state.covered[r][c]);
            }
        }

        const indicator = document.getElementById('turn-indicator');
        if (indicator) {
            indicator.textContent = idx === 0
                ? 'Start of game'
                : `T${_moves[idx-1].turn} P${_moves[idx-1].player}: ${_moves[idx-1].label}`;
        }

        const counter = document.getElementById('replay-step-counter');
        if (counter) counter.textContent = `${idx} / ${_moves.length}`;

        const atStart = idx === 0;
        const atEnd   = idx >= _moves.length;
        document.getElementById('replay-prev') ?.toggleAttribute('disabled', atStart);
        document.getElementById('replay-start')?.toggleAttribute('disabled', atStart);
        document.getElementById('replay-next') ?.toggleAttribute('disabled', atEnd);
        document.getElementById('replay-end')  ?.toggleAttribute('disabled', atEnd);
        if (analyzeBtn) analyzeBtn.toggleAttribute('disabled', atEnd);
    }

    // ── Analysis ──────────────────────────────────────────────────────────────

    const CELL_PX = 115;

    // Mask covered cells to player=0 (what the engine saw at the time).
    function maskState(state) {
        const board = [];
        for (let r = 0; r < BOARD_ROWS; r++) {
            board.push([]);
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = state.board[r][c];
                board[r][c] = (p && state.covered[r][c])
                    ? { type: 'unknown', power: 0, player: 0 }
                    : (p ? { ...p } : null);
            }
        }
        return { board, covered: state.covered.map(row => [...row]) };
    }

    // Target cell of a move (where the action lands).
    function getMoveTarget(move) {
        switch (move.type) {
            case 'move': case 'capture': case 'hop': return { r: move.toR,     c: move.toC     };
            case 'uncover':                          return { r: move.r,       c: move.c       };
            case 'engulf':                           return { r: move.r,       c: move.c       };
            case 'push':                             return { r: move.destR,   c: move.destC   };
            case 'snipe':                            return { r: move.targetR, c: move.targetC };
            case 'pyro':                             return { r: move.targetR, c: move.targetC };
            case 'transform':                        return { r: move.wizR,    c: move.wizC    };
            default: return null;
        }
    }

    // Source cell of a move (where the acting piece sits).
    function getMoveSource(move) {
        switch (move.type) {
            case 'move': case 'capture': case 'hop': return { r: move.fromR,  c: move.fromC  };
            case 'engulf':                           return { r: move.r,      c: move.c      };
            case 'push':  return move.drR !== undefined ? { r: move.drR, c: move.drC } : null;
            case 'snipe':                            return { r: move.robotR, c: move.robotC };
            case 'pyro':                             return { r: move.fromR,  c: move.fromC  };
            case 'transform':                        return { r: move.wizR,   c: move.wizC   };
            default: return null;
        }
    }

    // Loose match: same action family + same destination cell.
    function movesMatch(a, b) {
        const norm = t => (t === 'capture') ? 'move' : t;
        if (norm(a.type) !== norm(b.type)) return false;
        const ta = getMoveTarget(a), tb = getMoveTarget(b);
        return ta && tb && ta.r === tb.r && ta.c === tb.c;
    }

    function clearAnalysisSvg() {
        const el = document.getElementById('analysis-svg');
        if (el) el.remove();
    }

    function svgPt(r, c) {
        return { x: c * CELL_PX + CELL_PX / 2, y: r * CELL_PX + CELL_PX / 2 };
    }

    function svgArrow(svg, x1, y1, x2, y2, color, width, opacity) {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 5) return;
        const nx = dx / len, ny = dy / len;

        const startGap = 30, headLen = 13, headW = 7, tailGap = headLen + 12;
        const sx = x1 + nx * startGap, sy = y1 + ny * startGap;
        const ex = x2 - nx * tailGap,  ey = y2 - ny * tailGap;
        const hx = x2 - nx * 10,       hy = y2 - ny * 10;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', sx); line.setAttribute('y1', sy);
        line.setAttribute('x2', ex); line.setAttribute('y2', ey);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', width);
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', opacity);
        svg.appendChild(line);

        const bx = -ny * headW, by = nx * headW;
        const tbx = hx - nx * headLen, tby = hy - ny * headLen;
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', `${hx},${hy} ${tbx+bx},${tby+by} ${tbx-bx},${tby-by}`);
        poly.setAttribute('fill', color);
        poly.setAttribute('opacity', opacity);
        svg.appendChild(poly);
    }

    function svgText(svg, x, y, text, color, opacity) {
        // Dark backing for readability
        const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        shadow.setAttribute('x', x); shadow.setAttribute('y', y);
        shadow.setAttribute('fill', 'rgba(0,0,0,0.8)');
        shadow.setAttribute('font-size', '11');
        shadow.setAttribute('font-weight', 'bold');
        shadow.setAttribute('stroke', 'rgba(0,0,0,0.9)');
        shadow.setAttribute('stroke-width', '3');
        shadow.setAttribute('paint-order', 'stroke');
        shadow.setAttribute('opacity', opacity);
        shadow.textContent = text;
        svg.appendChild(shadow);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x); label.setAttribute('y', y);
        label.setAttribute('fill', color);
        label.setAttribute('font-size', '11');
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('opacity', opacity);
        label.textContent = text;
        svg.appendChild(label);
    }

    function drawAnalysisArrows(scoredMoves, actualMove) {
        clearAnalysisSvg();
        const boardEl = document.getElementById('board');
        if (!boardEl) return;

        const W = BOARD_COLS * CELL_PX, H = BOARD_ROWS * CELL_PX;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'analysis-svg';
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:20';

        // Rank colours: gold, silver, bronze, then dim blue-grey
        const COLORS = ['', '#c8a000', '#909090', '#b06020', '#4a6880', '#3a5870', '#2a4860', '#1a3850'];

        const top = scoredMoves.slice(0, 7);
        // Draw lower ranks first so top moves render on top
        [...top].reverse().forEach(({ move, score }, ri) => {
            const i = top.length - 1 - ri; // original rank index
            const rank = i + 1;
            const isActual = actualMove && movesMatch(move, actualMove);
            const color  = isActual ? '#44ee88' : (COLORS[rank] || COLORS[COLORS.length - 1]);
            const width  = rank === 1 ? 5 : rank <= 3 ? 3.5 : 2.5;
            const opac   = rank === 1 ? '0.92' : rank <= 3 ? '0.78' : '0.55';

            const src = getMoveSource(move);
            const tgt = getMoveTarget(move);
            if (!tgt) return;

            const tp = svgPt(tgt.r, tgt.c);

            if (src) {
                const sp = svgPt(src.r, src.c);
                svgArrow(svg, sp.x, sp.y, tp.x, tp.y, color, width, opac);
                // Label at midpoint, offset perpendicular
                const dx = tp.x - sp.x, dy = tp.y - sp.y;
                const len = Math.sqrt(dx*dx + dy*dy) || 1;
                const mx = (sp.x + tp.x) / 2 - (dy/len) * 14;
                const my = (sp.y + tp.y) / 2 + (dx/len) * 14;
                const scoreStr = `${score >= 0 ? '+' : ''}${Math.round(score)}`;
                svgText(svg, mx - 12, my + 4, `${rank}. ${scoreStr}`, color, opac);
            } else {
                // Uncover — pulsing ring around target cell
                const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circ.setAttribute('cx', tp.x); circ.setAttribute('cy', tp.y);
                circ.setAttribute('r', '32');
                circ.setAttribute('fill', 'none');
                circ.setAttribute('stroke', color);
                circ.setAttribute('stroke-width', width);
                circ.setAttribute('opacity', opac);
                svg.appendChild(circ);
                const scoreStr = `${score >= 0 ? '+' : ''}${Math.round(score)}`;
                svgText(svg, tp.x - 12, tp.y - 36, `${rank}. ${scoreStr}`, color, opac);
            }
        });

        // If the actual move ranked outside top 7, still draw it
        if (actualMove && !top.some(({ move }) => movesMatch(move, actualMove))) {
            const entry = scoredMoves.find(({ move }) => movesMatch(move, actualMove));
            if (entry) {
                const rank = scoredMoves.indexOf(entry) + 1;
                const src = getMoveSource(actualMove);
                const tgt = getMoveTarget(actualMove);
                if (tgt) {
                    const tp = svgPt(tgt.r, tgt.c);
                    if (src) {
                        const sp = svgPt(src.r, src.c);
                        svgArrow(svg, sp.x, sp.y, tp.x, tp.y, '#44ee88', 3, '0.85');
                        const dx = tp.x - sp.x, dy = tp.y - sp.y;
                        const len = Math.sqrt(dx*dx + dy*dy) || 1;
                        const mx = (sp.x + tp.x) / 2 - (dy/len) * 14;
                        const my = (sp.y + tp.y) / 2 + (dx/len) * 14;
                        const scoreStr = `${entry.score >= 0 ? '+' : ''}${Math.round(entry.score)}`;
                        svgText(svg, mx - 12, my + 4, `#${rank} ${scoreStr}`, '#44ee88', '0.85');
                    }
                }
            }
        }

        boardEl.appendChild(svg);
    }

    function analyze() {
        if (!_active || _stepIdx >= _moves.length) return;

        const analyzeBtn = document.getElementById('replay-analyze');
        if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.textContent = '⏳'; }

        const indicator = document.getElementById('turn-indicator');
        const moveMeta  = _moves[_stepIdx];          // the move about to be played
        const curState  = _states[_stepIdx];          // current board (pre-move)
        const player    = moveMeta.player;

        if (indicator) indicator.textContent = 'Analyzing…';

        const masked    = maskState(curState);
        const abilities = (typeof gameState !== 'undefined' && gameState.enabledAbilities)
                       || new Set(['push', 'engulf', 'hop', 'snipe', 'transform', 'pyromania']);

        setTimeout(() => {
            let scored;
            try {
                scored = SkillMinimax.getScoredMoves({
                    state: masked,
                    cpuPlayer: player,
                    enabledAbilities: abilities,
                    depth: null,
                });
            } catch (e) {
                console.error('Analysis error:', e);
                if (indicator) indicator.textContent = _stepIdx === 0 ? 'Start of game' : `T${_moves[_stepIdx-1].turn} P${_moves[_stepIdx-1].player}: ${_moves[_stepIdx-1].label}`;
                if (analyzeBtn) { analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍'; }
                return;
            }

            drawAnalysisArrows(scored, moveMeta);

            // Summary note
            if (indicator) {
                const actualEntry = scored.find(({ move }) => movesMatch(move, moveMeta));
                const actualRank  = actualEntry ? scored.indexOf(actualEntry) + 1 : '?';
                const note = actualRank === 1 ? '✓ best move'
                           : actualRank === '?' ? 'actual move unranked'
                           : `actual: #${actualRank} of ${scored.length}`;
                indicator.textContent = `T${moveMeta.turn} P${moveMeta.player}: ${moveMeta.label}  [${note}]`;
            }

            if (analyzeBtn) { analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍'; }
        }, 0);
    }

    // ── Keyboard ──────────────────────────────────────────────────────────────

    function onKey(e) {
        if (!_active) return;
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')  { goBack();    e.preventDefault(); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp')    { goForward(); e.preventDefault(); }
        if (e.key === 'Home')                                  { goToStart(); e.preventDefault(); }
        if (e.key === 'End')                                   { goToEnd();   e.preventDefault(); }
    }

    // ── Public ────────────────────────────────────────────────────────────────

    function load(text) {
        _states = [];
        _moves  = [];
        _stepIdx = 0;

        const lines = text.replace(/\r/g, '').split('\n');

        const boardStart = lines.findIndex(l => l.trim() === '--- Initial Board ---');
        const boardLines = [];
        if (boardStart >= 0) {
            for (let i = boardStart + 1; i < lines.length; i++) {
                if (lines[i].trim().startsWith('---') || lines[i].match(/^T\d+/)) break;
                boardLines.push(lines[i]);
            }
        }

        const initialBoard = parseInitialBoard(boardLines);
        const initialState = {
            board:   initialBoard,
            covered: Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(true)),
        };
        for (let r = 0; r < BOARD_ROWS; r++)
            for (let c = 0; c < BOARD_COLS; c++)
                if (!initialBoard[r][c]) initialState.covered[r][c] = false;

        _states.push(initialState);

        for (const line of lines) {
            if (!line.match(/^T\d+ P\d+:/)) continue;
            const move = parseMoveLine(line);
            if (!move) continue;
            _moves.push(move);
            _states.push(applyMoveToReplay(_states[_states.length - 1], move));
        }

        return _moves.length > 0;
    }

    function enter() {
        _active = true;
        document.addEventListener('keydown', onKey);

        document.getElementById('setup-screen').style.display        = 'none';
        document.getElementById('winner-message').style.display       = 'none';
        document.getElementById('skill-tray').style.display           = 'none';
        document.getElementById('replay-controls').style.display      = 'flex';
        document.getElementById('resign-button').style.display        = 'none';
        document.getElementById('help-button').style.display          = 'none';
        document.getElementById('exit-replay-btn').style.display      = 'block';
        document.getElementById('game-speed-row').style.display       = 'none';

        const ind = document.getElementById('turn-indicator');
        if (ind) ind.style.fontSize = '14px';

        initBoard();
        renderStep(0);
    }

    function exit() {
        _active  = false;
        _states  = [];
        _moves   = [];
        _stepIdx = 0;
        document.removeEventListener('keydown', onKey);

        document.getElementById('setup-screen').style.display         = '';
        document.getElementById('skill-tray').style.display           = '';
        document.getElementById('replay-controls').style.display      = 'none';
        document.getElementById('resign-button').style.display        = 'none';
        document.getElementById('turn-indicator').style.display       = 'none';
        document.getElementById('exit-replay-btn').style.display      = 'none';

        const ind = document.getElementById('turn-indicator');
        if (ind) ind.style.fontSize = '';
    }

    function goToStart() { _stepIdx = 0;               renderStep(_stepIdx); }
    function goBack()    { if (_stepIdx > 0)            { _stepIdx--; renderStep(_stepIdx); } }
    function goForward() { if (_stepIdx < _moves.length){ _stepIdx++; renderStep(_stepIdx); } }
    function goToEnd()   { _stepIdx = _moves.length;    renderStep(_stepIdx); }

    return { load, enter, exit, goToStart, goBack, goForward, goToEnd, analyze };
})();
