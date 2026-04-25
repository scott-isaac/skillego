// board.js - Board initialization and rendering

function initializeBoard() {
    console.log("Initializing board...");
    debugLog("Initializing game board");
    gameState.board   = Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
    gameState.covered = Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(true));
    const board = document.getElementById('board');
    if (!board) {
        console.error("Board element not found!");
        debugLog("ERROR: Board element not found!");
        return;
    }
    board.innerHTML = '';
    // Grid sizing is handled by CSS (#board { grid-template-columns/rows: repeat(6, 117.5px) })

    for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
            const cell = document.createElement('div');
            cell.classList.add('cell', 'covered');
            cell.dataset.row  = row;
            cell.dataset.col  = col;
            cell.dataset.tile = String(Math.floor(Math.random() * 3) + 1);
            cell.addEventListener('click', (e) => {
                handleCellClick(row, col, cell);
            });
            board.appendChild(cell);
        }
    }
    
    // Create winner message element if it doesn't exist
    if (!document.getElementById('winner-message')) {
        const gameContainer = document.querySelector('#game-container');
        if (gameContainer) {
            const winnerMessage = document.createElement('div');
            winnerMessage.id = 'winner-message';
            winnerMessage.textContent = '';
            winnerMessage.style.display = 'none';
            gameContainer.appendChild(winnerMessage);
        }
    }

    // Preload emoji fonts — on iOS/mobile, emoji glyphs are rasterized lazily and can
    // appear blank for one frame if encountered for the first time during a CSS transition.
    // Rendering them invisibly at game start warms the font cache before any piece uncovers.
    const emojiPreload = document.createElement('div');
    emojiPreload.style.cssText = 'position:absolute;opacity:0;pointer-events:none;font-size:30px;';
    emojiPreload.setAttribute('aria-hidden', 'true');
    emojiPreload.textContent = PIECES.map(p => p.emoji).join('');
    document.body.appendChild(emojiPreload);

    // Assign pieces to players randomly
    assignPieces();

    // Render initial covered state with tile backgrounds
    for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
            const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
            renderCell(el, gameState.board[row][col], true);
        }
    }
}

function assignPieces() {
    const allPieces = [];

    // Add pieces for both players
    for (let player = 1; player <= gameState.numPlayers; player++) {
        PIECES.forEach(piece => {
            for (let i = 0; i < piece.quantity; i++) {
                allPieces.push({ ...piece, player });
            }
        });
    }

    // Shuffle pieces
    allPieces.sort(() => Math.random() - 0.5);

    // Place pieces on the board
    let index = 0;
    for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
            if (index < allPieces.length) {
                gameState.board[row][col] = allPieces[index];
                index++;
            }
        }
    }
}

// Decide which piece art file to use for this square. Cats and robots have
// contextual variants that depend on neighbors:
//   cat + friendly robot adjacent  → piece_cat_heart.png   (love wins)
//   cat + enemy can capture it      → piece_cat_scared.png
//   robot + friendly cat adjacent   → piece_robot_heart.png
//   robot has a legal snipe         → piece_robot_angry.png
//   anything else                   → piece_<type>.png
// Adjacency is orthogonal and ignores covered pieces.
function _pieceSpriteKey(piece, r, c) {
    if (!piece) return null;
    if (piece.type === 'cat')   return _catSpriteKey(piece, r, c);
    if (piece.type === 'robot') return _robotSpriteKey(piece, r, c);
    return piece.type;
}
function _catSpriteKey(piece, r, c) {
    if (_hasAdjacentOwnKind(piece, r, c, 'robot')) return 'cat_heart';
    for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= BOARD_ROWS || nc >= BOARD_COLS) continue;
        if (gameState.covered[nr][nc]) continue;
        const adj = gameState.board[nr][nc];
        if (!adj || adj.player === piece.player) continue;
        if (canCapture(adj, piece)) return 'cat_scared';
    }
    return 'cat';
}
function _robotSpriteKey(piece, r, c) {
    // Angry beats heart for the robot: a robot mid-snipe is in kill-shot mode
    // even if a friendly cat happens to be adjacent (e.g., spotter Cat A next
    // to the robot while Cat B gives a snipe line in another direction).
    if (!piece.burning) {  // burning robots can't snipe
        const abilities = gameState.enabledAbilities;
        if (abilities && abilities.has && abilities.has('snipe') &&
            getSnipeMoves(gameState, r, c, abilities).length > 0) {
            return 'robot_angry';
        }
    }
    if (_hasAdjacentOwnKind(piece, r, c, 'cat')) return 'robot_heart';
    return 'robot';
}
function _hasAdjacentOwnKind(piece, r, c, kind) {
    for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= BOARD_ROWS || nc >= BOARD_COLS) continue;
        if (gameState.covered[nr][nc]) continue;
        const adj = gameState.board[nr][nc];
        if (adj && adj.player === piece.player && adj.type === kind) return true;
    }
    return false;
}

// Re-render every revealed piece cell. Called after moves so contextual sprite
// variants (scared/angry/heart) pick up changes in neighboring cells, not just
// the cells that moved. Cheap at 36–72 cells per board.
// Skips cells flagged with data-animating so the refresh doesn't stomp on a
// slide/hop that's still in flight (the animation's own onLand callback will
// render the correct final sprite when it finishes).
function refreshDynamicPieces() {
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = gameState.board[r][c];
            if (!p) continue;
            if (gameState.covered[r][c]) continue;
            const el = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
            if (!el || el.dataset.animating) continue;
            renderCell(el, p, false);
        }
    }
}

function updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    if (!turnIndicator) return;

    const text = _computeTurnLabel();
    turnIndicator.textContent = text;

    // Shrink font for long text. The name is already truncated inside
    // _computeTurnLabel so the "'s Turn" suffix always stays whole and
    // the ellipsis appears on the name, not on "Turn".
    turnIndicator.classList.remove('t-tight', 't-tighter');
    if      (text.length > 22) turnIndicator.classList.add('t-tighter');
    else if (text.length > 14) turnIndicator.classList.add('t-tight');
}

// Keep the name short enough that `Name's Turn` fits without clipping
// "'s Turn" off the end. 14 characters is a comfortable upper bound for the
// 42px font in the 580px indicator — longer names get the ellipsis.
function _truncName(name, max) {
    if (!name) return '';
    max = max || 14;
    return name.length <= max ? name : (name.slice(0, max - 1) + '…');
}

function _computeTurnLabel() {
    const cp = gameState.currentPlayer;

    // Tournament match — prefer player display names for both participants
    // and spectators. "Your Turn" stays for the active player so it reads
    // naturally in the middle of a game.
    const tm = typeof tournamentMode !== 'undefined' ? tournamentMode : null;
    if (tm && tm.currentGame) {
        const name = cp === 1 ? tm.currentGame.nameA : tm.currentGame.nameB;
        if (serverMode.playerNumber && cp === serverMode.playerNumber) return "Your Turn";
        return `${_truncName(name)}'s Turn`;
    }

    // Non-tournament network game: generic "Your Turn" / "Opponent's Turn"
    if (typeof serverMode !== 'undefined' && serverMode.active && serverMode.playerNumber) {
        return cp === serverMode.playerNumber ? "Your Turn" : "Opponent's Turn";
    }

    // Local play (vs CPU or hotseat)
    const config = gameState[`player${cp}`];
    const isCpu  = config && config.type === 'cpu';
    const label  = isCpu ? `CPU (P${cp})` : `Player ${cp}`;
    return `${label}'s Turn`;
}

function highlightCell(row, col, className) {
    const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (cellElement) {
        cellElement.classList.add(className);
    }
}

// Radial gold glow used as a background layer beneath pieces
// Gold highlight behind pieces — mimics inset box-shadow but as a background layer
const LAST_MOVE_GLOW = 'linear-gradient(rgba(200,169,110,0.5), rgba(200,169,110,0.5))';

function showLastMove(cells) {
    // Cells in the new list are about to be rendered by the caller (often via an
    // animation callback). Skip them here so we don't paint a stale piece into a
    // destination square before the slide starts.
    const skip = new Set(cells.map(({ row, col }) => `${row},${col}`));
    document.querySelectorAll('.last-move').forEach(el => {
        el.classList.remove('last-move');
        const r = +el.dataset.row, c = +el.dataset.col;
        if (skip.has(`${r},${c}`)) return;
        renderCell(el, gameState.board[r]?.[c], gameState.covered[r]?.[c]);
    });
    // Set class on new cells — the caller's renderCell will pick up the glow
    for (const { row, col } of cells) {
        const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        if (el) el.classList.add('last-move');
    }
}

function clearLastMove() {
    document.querySelectorAll('.last-move').forEach(el => {
        el.classList.remove('last-move');
        const r = +el.dataset.row, c = +el.dataset.col;
        renderCell(el, gameState.board[r]?.[c], gameState.covered[r]?.[c]);
    });
}

function clearValidMoves() {
    document.querySelectorAll('.valid-move, .valid-capture').forEach(cell => {
        cell.classList.remove('valid-move', 'valid-capture');
    });
    gameState.validMoves = [];
}

function movePiece(fromRow, fromCol, toRow, toCol) {
    const fromPiece = gameState.board[fromRow][fromCol];
    const toPiece = gameState.board[toRow][toCol];

    // Update board state
    gameState.board[toRow][toCol]     = fromPiece;
    gameState.board[fromRow][fromCol] = null;
    gameState.covered[toRow][toCol]   = false;

    showLastMove([{ row: fromRow, col: fromCol }, { row: toRow, col: toCol }]);

    const fromCell = document.querySelector(`.cell[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const toCell   = document.querySelector(`.cell[data-row="${toRow}"][data-col="${toCol}"]`);

    // Burn-down: resolve state before the slide so the callback renders the right thing
    if (fromPiece.burning) {
        fromPiece.power--;
        if (fromPiece.power <= 0) {
            gameState.board[toRow][toCol] = null;
            if (toPiece) debugLog(`P${fromPiece.player} burning piece captured ${toPiece.type} then burned out`);
            if (typeof gameLog !== 'undefined') {
                gameLog.recordMove(fromPiece.player, fromRow, fromCol, toRow, toCol, fromPiece, toPiece || null);
            }
            toCell.classList.remove('valid-move', 'valid-capture');
            slidePiece(fromCell, toCell, fromPiece, () => renderCell(toCell, null, false));
            renderCell(fromCell, null, false);
            checkGameOver();
            return;
        }
        const lvl = BURN_LEVEL[fromPiece.power];
        fromPiece.type  = lvl.type;
        fromPiece.emoji = lvl.emoji;
    }

    // Slide ghost over destination; swap in the piece when it lands
    toCell.classList.remove('valid-move', 'valid-capture');
    slidePiece(fromCell, toCell, fromPiece, () => renderCell(toCell, fromPiece, false));
    renderCell(fromCell, null, false);

    if (toPiece) {
        debugLog(`Player ${fromPiece.player} captured Player ${toPiece.player}'s ${toPiece.type} with a ${fromPiece.type}`);
    }
    if (typeof gameLog !== 'undefined') {
        gameLog.recordMove(fromPiece.player, fromRow, fromCol, toRow, toCol, fromPiece, toPiece || null);
    }

    checkGameOver();
}

// Player index → art folder name
const PLAYER_ART = ['', 'red', 'blue', 'yellow', 'green'];

// Slide a ghost of the moving piece from source to destination.
// onLand fires when the ghost arrives; ghost fades out and is removed shortly after.
function slidePiece(fromEl, toEl, piece, onLand) {
    if (!fromEl || !toEl || !gameState.animationsEnabled) { if (onLand) onLand(); return; }
    const board = document.getElementById('board');
    const color = PLAYER_ART[piece.player];

    const ghost = document.createElement('div');
    ghost.style.cssText = [
        'position:absolute',
        `left:${fromEl.offsetLeft}px`,
        `top:${fromEl.offsetTop}px`,
        `width:${fromEl.offsetWidth}px`,
        `height:${fromEl.offsetHeight}px`,
        `background-image:url('assets/piece_${piece.type}.png'),url('assets/player_${color}.png')`,
        'background-size:65% 65%,85% 85%',
        'background-repeat:no-repeat',
        'background-position:center',
        'pointer-events:none',
        'z-index:1000',
        'will-change:transform,opacity',
    ].join(';');
    board.appendChild(ghost);

    const dx = toEl.offsetLeft - fromEl.offsetLeft;
    const dy = toEl.offsetTop  - fromEl.offsetTop;
    const SLIDE_MS = 140;

    // Flag the destination so refreshDynamicPieces (which iterates the whole
    // board on endTurn) doesn't paint the landed sprite underneath the ghost.
    toEl.dataset.animating = '1';

    requestAnimationFrame(() => {
        ghost.style.transition = `transform ${SLIDE_MS}ms ease-out, opacity 60ms ease-in ${SLIDE_MS}ms`;
        ghost.style.transform  = `translate(${dx}px,${dy}px)`;
        ghost.style.opacity    = '0';
    });

    setTimeout(() => {
        delete toEl.dataset.animating;
        if (onLand) onLand();
    }, SLIDE_MS);
    setTimeout(() => ghost.remove(), SLIDE_MS + 80);
}

// Flip the mouse ghost from source over the piece in the middle, landing at destination.
function hopPiece(fromEl, toEl, piece, onLand) {
    if (!fromEl || !toEl || !gameState.animationsEnabled) { if (onLand) onLand(); return; }
    const board = document.getElementById('board');
    const color = PLAYER_ART[piece.player];

    const ghost = document.createElement('div');
    ghost.style.cssText = [
        'position:absolute',
        `left:${fromEl.offsetLeft}px`,
        `top:${fromEl.offsetTop}px`,
        `width:${fromEl.offsetWidth}px`,
        `height:${fromEl.offsetHeight}px`,
        `background-image:url('assets/piece_${piece.type}.png'),url('assets/player_${color}.png')`,
        'background-size:65% 65%,85% 85%',
        'background-repeat:no-repeat',
        'background-position:center',
        'pointer-events:none',
        'z-index:1000',
    ].join(';');
    board.appendChild(ghost);

    const dx  = toEl.offsetLeft - fromEl.offsetLeft;
    const dy  = toEl.offsetTop  - fromEl.offsetTop;
    const DUR = 260;

    // Use rotateY for left/right hops, rotateX for up/down hops
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'rotateY' : 'rotateX';

    toEl.dataset.animating = '1';

    ghost.animate([
        { transform: `perspective(300px) translate(0px,0px)               ${axis}(0deg)   scale(1)`   },
        { transform: `perspective(300px) translate(${dx*.5}px,${dy*.5}px) ${axis}(180deg) scale(1.4)`, offset: 0.45 },
        { transform: `perspective(300px) translate(${dx}px,${dy}px)       ${axis}(360deg) scale(1)`   },
    ], { duration: DUR, easing: 'ease-in-out', fill: 'forwards' });

    setTimeout(() => {
        ghost.remove();
        delete toEl.dataset.animating;
        if (onLand) onLand();
    }, DUR);
}

// Central cell renderer — switches between covered / uncovered / empty using art images.
// Call with (el, piece, covered). Always pass the current board state values.
function renderCell(el, piece, covered) {
    el.textContent = '';
    const tile = `url('assets/tile_${el.dataset.tile || '1'}.png')`;
    const glow = el.classList.contains('last-move') ? LAST_MOVE_GLOW : '';
    const r = +el.dataset.row, c = +el.dataset.col;
    const blocked = isPushBlocked(gameState, r, c);
    if (!piece) {
        // Empty square — stone tile + push-block gif if applicable + last-move glow
        const pushGif = blocked ? "url('assets/gifs/dragon_push.gif')" : '';
        if (pushGif && glow) {
            el.style.backgroundImage = `${pushGif}, ${glow}, ${tile}`;
            el.style.backgroundSize  = '80% 80%, 100% 100%, 100% 100%';
        } else if (pushGif) {
            el.style.backgroundImage = `${pushGif}, ${tile}`;
            el.style.backgroundSize  = '80% 80%, 100% 100%';
        } else if (glow) {
            el.style.backgroundImage = `${glow}, ${tile}`;
            el.style.backgroundSize  = '100% 100%, 100% 100%';
        } else {
            el.style.backgroundImage = tile;
            el.style.backgroundSize  = '100% 100%';
        }
        el.style.backgroundRepeat   = 'no-repeat';
        el.style.backgroundPosition = 'center';
        el.style.backgroundColor = '';
        el.classList.remove('covered', 'burning');
    } else if (covered) {
        // Covered piece — ? overlay on stone tile
        el.style.backgroundImage = glow
            ? `url('assets/piece_uncovered.png'), ${glow}, ${tile}`
            : `url('assets/piece_uncovered.png'), ${tile}`;
        el.style.backgroundSize  = glow ? '75% 75%, 100% 100%, 100% 100%' : '75% 75%, 100% 100%';
        el.style.backgroundColor = '';
        el.classList.add('covered');
        el.classList.remove('burning');
    } else {
        // Revealed: piece + [fire gif if burning] + player colour + highlight + stone tile
        const color = PLAYER_ART[piece.player];
        const sprite = _pieceSpriteKey(piece, r, c);
        if (piece.burning) {
            el.style.backgroundImage = glow
                ? `url('assets/piece_${sprite}.png'), url('assets/gifs/fire_${color}.gif'), url('assets/player_${color}.png'), ${glow}, ${tile}`
                : `url('assets/piece_${sprite}.png'), url('assets/gifs/fire_${color}.gif'), url('assets/player_${color}.png'), ${tile}`;
            el.style.backgroundSize  = glow ? '63% 63%, 107% 72%, 85% 85%, 100% 100%, 100% 100%' : '63% 63%, 107% 72%, 85% 85%, 100% 100%';
        } else {
            el.style.backgroundImage = glow
                ? `url('assets/piece_${sprite}.png'), url('assets/player_${color}.png'), ${glow}, ${tile}`
                : `url('assets/piece_${sprite}.png'), url('assets/player_${color}.png'), ${tile}`;
            el.style.backgroundSize  = glow ? '65% 65%, 85% 85%, 100% 100%, 100% 100%' : '65% 65%, 85% 85%, 100% 100%';
        }
        el.style.backgroundColor = '';
        el.classList.remove('covered');
        if (piece.burning) el.classList.add('burning');
        else el.classList.remove('burning');
    }
}

