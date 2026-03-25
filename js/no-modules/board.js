// board.js - Board initialization and rendering

function initializeBoard() {
    console.log("Initializing board...");
    debugLog("Initializing game board");
    gameState.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    gameState.covered = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(true));
    const board = document.getElementById('board');
    if (!board) {
        console.error("Board element not found!");
        debugLog("ERROR: Board element not found!");
        return;
    }
    board.innerHTML = '';
    
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
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
    for (let player = 1; player <= 2; player++) {
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
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
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
    const config = gameState.currentPlayer === 1 ? gameState.player1 : gameState.player2;
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
    document.querySelectorAll('.valid-move, .valid-capture, .valid-push, .push-destination').forEach(cell => {
        cell.classList.remove('valid-move', 'valid-capture', 'valid-push', 'push-destination');
        delete cell.dataset.pushArrow;
    });
    gameState.validMoves = [];
    gameState.validPushes = [];
}

function movePiece(fromRow, fromCol, toRow, toCol) {
    const fromPiece = gameState.board[fromRow][fromCol];
    const toPiece = gameState.board[toRow][toCol];
    
    // Update the board state
    gameState.board[toRow][toCol] = fromPiece;
    gameState.board[fromRow][fromCol] = null;
    
    // Update the visual representation
    const fromCell = document.querySelector(`.cell[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const toCell = document.querySelector(`.cell[data-row="${toRow}"][data-col="${toCol}"]`);
    
    // Clear source cell
    fromCell.textContent = '';
    fromCell.style.backgroundColor = '#e0c9a6';  // Reset to board cell color
    
    // Update target cell
    toCell.textContent = fromPiece.emoji;
    toCell.style.backgroundColor = PLAYER_COLORS[fromPiece.player];
    toCell.classList.remove('covered', 'valid-move', 'valid-capture');
    gameState.covered[toRow][toCol] = false;
    
    // Log capture if applicable
    if (toPiece) {
        debugLog(`Player ${fromPiece.player} captured Player ${toPiece.player}'s ${toPiece.type} with a ${fromPiece.type}`);
    }

    if (typeof gameLog !== 'undefined') {
        gameLog.recordMove(fromPiece.player, fromRow, fromCol, toRow, toCol, fromPiece, toPiece || null);
    }

    // Check if the game is over after the move
    checkGameOver();
}

/**
 * Checks if the game is over (a player has no pieces left)
 * Sets gameState.gameOver to true if a player has no pieces left
 * and displays a message indicating which player won
 */
function checkGameOver() {
    // Check if each player has any pieces left
    let player1HasPieces = false;
    let player2HasPieces = false;
    
    // Loop through the board to find pieces
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece) {
                if (piece.player === 1) {
                    player1HasPieces = true;
                } else if (piece.player === 2) {
                    player2HasPieces = true;
                }
            }
            
            // Early exit if we found pieces for both players
            if (player1HasPieces && player2HasPieces) {
                return;
            }
        }
    }
      // If one player has no pieces, game is over
    if (!player1HasPieces || !player2HasPieces) {
        gameState.gameOver = true;
        
        // Determine winner
        const winner = !player1HasPieces ? 2 : 1;
        const winnerMessage = document.getElementById('winner-message');
        
        if (winnerMessage) {
            winnerMessage.textContent = `Player ${winner} wins!`;
            winnerMessage.style.display = 'block';
        }
        
        debugLog(`Game over! Player ${winner} wins!`);
    }
}
