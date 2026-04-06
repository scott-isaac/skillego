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

function updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    if (!turnIndicator) return;
    const playerKey = `player${gameState.currentPlayer}`;
    const config = gameState[playerKey];
    const isCpu  = config && config.type === 'cpu';
    const label  = isCpu ? `CPU (P${gameState.currentPlayer})` : `Player ${gameState.currentPlayer}`;
    turnIndicator.textContent = `${label}'s Turn`;
}

function highlightCell(row, col, className) {
    const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (cellElement) {
        cellElement.classList.add(className);
    }
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
    if (!fromEl || !toEl) { if (onLand) onLand(); return; }
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

    requestAnimationFrame(() => {
        ghost.style.transition = `transform ${SLIDE_MS}ms ease-out, opacity 60ms ease-in ${SLIDE_MS}ms`;
        ghost.style.transform  = `translate(${dx}px,${dy}px)`;
        ghost.style.opacity    = '0';
    });

    setTimeout(() => { if (onLand) onLand(); },       SLIDE_MS);
    setTimeout(() => ghost.remove(),                   SLIDE_MS + 80);
}

// Flip the mouse ghost from source over the piece in the middle, landing at destination.
function hopPiece(fromEl, toEl, piece, onLand) {
    if (!fromEl || !toEl) { if (onLand) onLand(); return; }
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

    ghost.animate([
        { transform: `perspective(300px) translate(0px,0px)               ${axis}(0deg)   scale(1)`   },
        { transform: `perspective(300px) translate(${dx*.5}px,${dy*.5}px) ${axis}(180deg) scale(1.4)`, offset: 0.45 },
        { transform: `perspective(300px) translate(${dx}px,${dy}px)       ${axis}(360deg) scale(1)`   },
    ], { duration: DUR, easing: 'ease-in-out', fill: 'forwards' });

    setTimeout(() => {
        ghost.remove();
        if (onLand) onLand();
    }, DUR);
}

// Central cell renderer — switches between covered / uncovered / empty using art images.
// Call with (el, piece, covered). Always pass the current board state values.
function renderCell(el, piece, covered) {
    el.textContent = '';
    const tile = `url('assets/tile_${el.dataset.tile || '1'}.png')`;
    if (!piece) {
        // Empty square — just the stone tile
        el.style.backgroundImage = tile;
        el.style.backgroundSize  = '100% 100%';
        el.style.backgroundColor = '';
        el.classList.remove('covered', 'burning');
    } else if (covered) {
        // Covered piece — ? overlay on stone tile
        el.style.backgroundImage = `url('assets/piece_uncovered.png'), ${tile}`;
        el.style.backgroundSize  = '75% 75%, 100% 100%';
        el.style.backgroundColor = '';
        el.classList.add('covered');
        el.classList.remove('burning');
    } else {
        // Revealed: piece + [fire gif if burning] + player colour + stone tile
        const color = PLAYER_ART[piece.player];
        if (piece.burning) {
            el.style.backgroundImage = `url('assets/piece_${piece.type}.png'), url('assets/gifs/fire_${color}.gif'), url('assets/player_${color}.png'), ${tile}`;
            el.style.backgroundSize  = '63% 63%, 107% 72%, 85% 85%, 100% 100%';
        } else {
            el.style.backgroundImage = `url('assets/piece_${piece.type}.png'), url('assets/player_${color}.png'), ${tile}`;
            el.style.backgroundSize  = '65% 65%, 85% 85%, 100% 100%';
        }
        el.style.backgroundColor = '';
        el.classList.remove('covered');
        if (piece.burning) el.classList.add('burning');
        else el.classList.remove('burning');
    }
}

