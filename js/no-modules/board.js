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
    board.style.gridTemplateColumns = `repeat(${BOARD_COLS}, 60px)`;
    board.style.gridTemplateRows    = `repeat(${BOARD_ROWS}, 60px)`;

    for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
            const cell = document.createElement('div');
            cell.classList.add('cell', 'covered');
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.addEventListener('click', (e) => {
                // Direct reference to handleCellClick since we're not using modules
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

    // Assign pieces to players randomly
    assignPieces();
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
    turnIndicator.style.backgroundColor = PLAYER_COLORS[gameState.currentPlayer];
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

    // Visual: clear source cell
    const fromCell = document.querySelector(`.cell[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const toCell   = document.querySelector(`.cell[data-row="${toRow}"][data-col="${toCol}"]`);
    fromCell.textContent = '';
    fromCell.style.backgroundColor = '#e0c9a6';
    fromCell.classList.remove('burning');

    // Burn-down: burning piece loses 1 power on every move
    if (fromPiece.burning) {
        fromPiece.power--;
        if (fromPiece.power <= 0) {
            // Burns out — the piece captured anything on the destination then vanishes
            gameState.board[toRow][toCol] = null;
            toCell.textContent = '';
            toCell.style.backgroundColor = '#e0c9a6';
            toCell.classList.remove('covered', 'valid-move', 'valid-capture', 'burning');
            if (toPiece) debugLog(`P${fromPiece.player} burning piece captured ${toPiece.type} then burned out`);
            if (typeof gameLog !== 'undefined') {
                gameLog.recordMove(fromPiece.player, fromRow, fromCol, toRow, toCol, fromPiece, toPiece || null);
            }
            checkGameOver();
            return;
        }
        // Step down to next power level
        const lvl = BURN_LEVEL[fromPiece.power];
        fromPiece.type  = lvl.type;
        fromPiece.emoji = lvl.emoji;
    }

    // Visual: update destination cell
    toCell.textContent = fromPiece.emoji;
    toCell.style.backgroundColor = PLAYER_COLORS[fromPiece.player];
    toCell.classList.remove('covered', 'valid-move', 'valid-capture', 'burning');
    if (fromPiece.burning) toCell.classList.add('burning');

    if (toPiece) {
        debugLog(`Player ${fromPiece.player} captured Player ${toPiece.player}'s ${toPiece.type} with a ${fromPiece.type}`);
    }
    if (typeof gameLog !== 'undefined') {
        gameLog.recordMove(fromPiece.player, fromRow, fromCol, toRow, toCol, fromPiece, toPiece || null);
    }

    checkGameOver();
}

