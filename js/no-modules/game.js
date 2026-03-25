// game.js - Core game logic

function handleCellClick(row, col, cellElement) {
    debugLog(`handleCellClick called at (${row}, ${col})`);
    
    // If the game is over or it's CPU's turn, ignore clicks
    if (gameState.gameOver) {
        debugLog("Ignoring click - game is over");
        return;
    }

    // In CPU vs CPU mode, all clicks are ignored
    if (gameState.cpuVsCpu) {
        debugLog("Ignoring click - CPU vs CPU mode active");
        return;
    }

    // If it's CPU's turn and CPU is enabled, ignore human clicks
    if (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer) {
        debugLog("Ignoring click during CPU turn");
        return;
    }
    
    const cell = gameState.board[row][col];
    
    // If no cell is selected and the clicked cell has a piece belonging to the current player
    if (!gameState.selectedCell && cell && !gameState.covered[row][col] && cell.player === gameState.currentPlayer) {
        // Select the cell
        gameState.selectedCell = { row, col, piece: cell };
        cellElement.classList.add('selected');

        // Show valid moves
        gameState.validMoves = getValidMoves(row, col);
        for (const move of gameState.validMoves) {
            highlightCell(move.row, move.col, 'valid-move');
        }

        // Populate skill tray for this piece
        populateSkillTray(cell, row, col);
    }
    // If a cell is already selected
    else if (gameState.selectedCell) {
        // Check if the clicked cell is a valid move
        if (isValidMove(gameState.selectedCell.row, gameState.selectedCell.col, row, col)) {
            // Move the piece
            movePiece(gameState.selectedCell.row, gameState.selectedCell.col, row, col);
            
            // checkGameOver is now called inside movePiece function
            // Only continue normal turn flow if game is not over
            if (!gameState.gameOver) {
                // Switch turn
                gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
                updateTurnIndicator();
                
                // If CPU is enabled and it's CPU's turn, make a move
                if (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer) {
                    debugLog("Scheduling CPU move after human's move");
                    setTimeout(makeCpuMove, 800);
                }
            }
        }
        
        // Clear selection, valid moves, and skill tray
        const selectedCellElement = document.querySelector(`.cell[data-row="${gameState.selectedCell.row}"][data-col="${gameState.selectedCell.col}"]`);
        if (selectedCellElement) selectedCellElement.classList.remove('selected');
        clearValidMoves();
        clearSkillTray();
        gameState.selectedCell = null;
    }
    // If no cell is selected and clicked on a covered piece
    else if (cell && gameState.covered[row][col]) {
        // Uncover the piece
        gameState.covered[row][col] = false;
        cellElement.classList.remove('covered');
        cellElement.style.backgroundColor = gameState.playerColors[cell.player];
        cellElement.textContent = cell.emoji;
        if (typeof gameLog !== 'undefined') gameLog.recordUncover(gameState.currentPlayer, row, col, cell);
        
        // Check if the game is over after uncovering
        checkGameOver();
        
        // If game is not over, continue with next turn
        if (!gameState.gameOver) {
            // Switch turn
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            updateTurnIndicator();
            
            // If CPU is enabled and it's CPU's turn, make a move
            if (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer) {
                debugLog("Scheduling CPU move after human uncovered a piece");
                setTimeout(makeCpuMove, 800);
            }
        }
    }
}

function isValidMove(fromRow, fromCol, toRow, toCol) {
    return gameState.validMoves.some(move => move.row === toRow && move.col === toCol);
}

// ── Skill tray ────────────────────────────────────────────────────────────────
// Permanent 5-slot tray below the board. Populates based on selected piece.
// Directional abilities (push) get one button per direction — one click fires.

const SKILL_TRAY_SLOTS = 5;

function getPushButtons(dragonRow, dragonCol) {
    const piece = gameState.board[dragonRow][dragonCol];
    const dirs = [
        { dr: -1, dc:  0, icon: '↑', label: 'Push Up' },
        { dr:  1, dc:  0, icon: '↓', label: 'Push Down' },
        { dr:  0, dc: -1, icon: '←', label: 'Push Left' },
        { dr:  0, dc:  1, icon: '→', label: 'Push Right' },
    ];
    const SPELL_ICON = '💨';
    return dirs.map(({ dr, dc, icon, label }) => {
        const er = dragonRow + dr, ec = dragonCol + dc;
        const destR = dragonRow + 2*dr, destC = dragonCol + 2*dc;
        const inBounds = er >= 0 && er < BOARD_SIZE && ec >= 0 && ec < BOARD_SIZE &&
                         destR >= 0 && destR < BOARD_SIZE && destC >= 0 && destC < BOARD_SIZE;
        const enemy = inBounds ? gameState.board[er][ec] : null;
        const dest  = inBounds ? gameState.board[destR][destC] : null;
        const enabled = !!(inBounds && enemy && enemy.player !== piece.player &&
                           !gameState.covered[er][ec] && dest === null);
        return {
            icon, label, spellIcon: SPELL_ICON,
            enabled,
            enemyRow: er, enemyCol: ec,
            destRow: destR, destCol: destC,
            action: enabled ? () => executePush(dragonRow, dragonCol, er, ec, destR, destC) : null,
        };
    });
}

function getHopButtons(row, col) {
    const dirs = [
        { dr: -1, dc:  0, icon: '↑', label: 'Hop Up' },
        { dr:  1, dc:  0, icon: '↓', label: 'Hop Down' },
        { dr:  0, dc: -1, icon: '←', label: 'Hop Left' },
        { dr:  0, dc:  1, icon: '→', label: 'Hop Right' },
    ];
    const SPELL_ICON = '🐾';
    return dirs.map(({ dr, dc, icon, label }) => {
        const midR = row + dr, midC = col + dc;
        const destR = row + 2*dr, destC = col + 2*dc;
        const inBounds = midR >= 0 && midR < BOARD_SIZE && midC >= 0 && midC < BOARD_SIZE &&
                         destR >= 0 && destR < BOARD_SIZE && destC >= 0 && destC < BOARD_SIZE;
        const middle = inBounds ? gameState.board[midR][midC] : null;
        const dest   = inBounds ? gameState.board[destR][destC] : null;
        const enabled = !!(inBounds && middle !== null && dest === null);
        return {
            icon, label, spellIcon: SPELL_ICON,
            enabled,
            destRow: destR, destCol: destC,
            action: enabled ? () => executeHop(row, col, destR, destC) : null,
        };
    });
}

function buildSkillButtons(piece, row, col) {
    if (!piece || !(typeof PIECE_ABILITIES !== 'undefined' && PIECE_ABILITIES[piece.type])) return [];
    const buttons = [];
    for (const abilityId of PIECE_ABILITIES[piece.type]) {
        if (abilityId === 'push') buttons.push(...getPushButtons(row, col));
        if (abilityId === 'hop')  buttons.push(...getHopButtons(row, col));
    }
    return buttons.slice(0, SKILL_TRAY_SLOTS);
}

function populateSkillTray(piece, row, col) {
    const slots = document.querySelectorAll('.skill-slot');
    if (!slots.length) return;
    const buttons = buildSkillButtons(piece, row, col);
    slots.forEach((slot, i) => {
        slot.textContent = '';
        slot.onclick = null;
        slot.onmouseenter = null;
        slot.onmouseleave = null;
        slot.disabled = true;
        slot.className = 'skill-slot';
        slot.title = '';
        delete slot.dataset.spellIcon;
        if (i < buttons.length) {
            const b = buttons[i];
            slot.textContent = b.icon;
            slot.title = b.label;
            slot.disabled = !b.enabled;
            if (b.spellIcon) slot.dataset.spellIcon = b.spellIcon;
            if (b.enabled) {
                slot.classList.add('skill-available');
                slot.onclick = () => { b.action(); };
                // Preview destination on hover
                slot.onmouseenter = () => {
                    const el = document.querySelector(`.cell[data-row="${b.destRow}"][data-col="${b.destCol}"]`);
                    if (el) el.classList.add('push-destination-preview');
                };
                slot.onmouseleave = () => {
                    document.querySelectorAll('.push-destination-preview')
                        .forEach(el => el.classList.remove('push-destination-preview'));
                };
            }
        }
    });
}

function clearSkillTray() {
    document.querySelectorAll('.skill-slot').forEach(slot => {
        slot.textContent = '';
        slot.onclick = null;
        slot.onmouseenter = null;
        slot.onmouseleave = null;
        slot.disabled = true;
        slot.className = 'skill-slot';
        slot.title = '';
        delete slot.dataset.spellIcon;
    });
    document.querySelectorAll('.push-destination-preview')
        .forEach(el => el.classList.remove('push-destination-preview'));
}

function executeHop(mouseRow, mouseCol, destRow, destCol) {
    const mouse = gameState.board[mouseRow][mouseCol];

    gameState.board[destRow][destCol] = mouse;
    gameState.board[mouseRow][mouseCol] = null;
    gameState.covered[destRow][destCol] = false;

    const fromEl = document.querySelector(`.cell[data-row="${mouseRow}"][data-col="${mouseCol}"]`);
    const toEl   = document.querySelector(`.cell[data-row="${destRow}"][data-col="${destCol}"]`);
    fromEl.textContent = '';
    fromEl.style.backgroundColor = '#e0c9a6';
    toEl.textContent = mouse.emoji;
    toEl.style.backgroundColor = PLAYER_COLORS[mouse.player];

    if (typeof gameLog !== 'undefined') gameLog.recordHop(gameState.currentPlayer, mouseRow, mouseCol, destRow, destCol);

    clearValidMoves();
    clearSkillTray();
    const selEl = document.querySelector(`.cell[data-row="${mouseRow}"][data-col="${mouseCol}"]`);
    if (selEl) selEl.classList.remove('selected');
    gameState.selectedCell = null;

    checkGameOver();
    if (!gameState.gameOver) {
        gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
        updateTurnIndicator();
        if (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer) {
            setTimeout(makeCpuMove, gameState.cpuMoveDelay);
        }
    }
}

function executePush(dragonRow, dragonCol, enemyRow, enemyCol, destRow, destCol) {
    const enemy = gameState.board[enemyRow][enemyCol];

    gameState.board[destRow][destCol] = enemy;
    gameState.board[enemyRow][enemyCol] = null;
    gameState.covered[destRow][destCol] = false;

    const fromEl = document.querySelector(`.cell[data-row="${enemyRow}"][data-col="${enemyCol}"]`);
    const toEl   = document.querySelector(`.cell[data-row="${destRow}"][data-col="${destCol}"]`);
    fromEl.textContent = '';
    fromEl.style.backgroundColor = '#e0c9a6';
    toEl.textContent = enemy.emoji;
    toEl.style.backgroundColor = PLAYER_COLORS[enemy.player];

    if (typeof gameLog !== 'undefined') {
        gameLog.recordPush(gameState.currentPlayer, dragonRow, dragonCol,
            enemyRow, enemyCol, destRow, destCol, enemy);
    }

    clearValidMoves();
    clearSkillTray();
    const selEl = document.querySelector(`.cell[data-row="${dragonRow}"][data-col="${dragonCol}"]`);
    if (selEl) selEl.classList.remove('selected');
    gameState.selectedCell = null;

    checkGameOver();
    if (!gameState.gameOver) {
        gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
        updateTurnIndicator();
        if (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer) {
            setTimeout(makeCpuMove, gameState.cpuMoveDelay);
        }
    }
}

function getValidMoves(row, col) {
    const piece = gameState.board[row][col];
    const validMoves = [];
    
    // Check all four directions (up, right, down, left)
    const directions = [
        [-1, 0], // up
        [0, 1],  // right
        [1, 0],  // down
        [0, -1]  // left
    ];
    
    directions.forEach(([dRow, dCol]) => {
        const newRow = row + dRow;
        const newCol = col + dCol;
        
        // Check if the new position is within the board
        if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE) {
            const targetCell = gameState.board[newRow][newCol];
            
            // Empty cell is a valid move
            if (!targetCell) {
                validMoves.push({ row: newRow, col: newCol });                
            } 
            // Cell with opponent's piece
            else if (targetCell.player !== piece.player && !gameState.covered[newRow][newCol]) {
                // Check capture rules
                if (canCapture(piece, targetCell)) {
                    validMoves.push({ row: newRow, col: newCol });                    
                }
            }
        }
    });

    return validMoves;
}

function canCapture(piece, targetPiece) {
    // Check if the piece can capture the target piece
    if (piece.player === targetPiece.player) {
        return false; // Cannot capture own pieces
    }
    
    // Capture rules
    if (targetPiece.type === 'mouse' && piece.type === 'dragon') {
        return false; // Dragon cannot capture mouse
    } else if (piece.power >= targetPiece.power) {
        return true; // Higher power can capture lower power
    } else if (piece.type === 'mouse' && targetPiece.type === 'dragon') {
        return true; // Mouse can capture dragon
    }
    
    return false; // Default case, cannot capture
}

function checkGameOver() {
    // Check if any player has no pieces left or no legal moves
    let player1Pieces = 0;
    let player2Pieces = 0;
    let player1HasMoves = false;
    let player2HasMoves = false;
    

    // Count pieces and check for legal moves
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece) {
                    if (!gameState.covered[row][col]) {
                    if (piece.player === 1) {
                        player1Pieces++;
                        if (!player1HasMoves) {
                            const validMoves = getValidMoves(row, col);
                            player1HasMoves = validMoves.length > 0;
                        }
                    } else {
                        player2Pieces++;
                        if (!player2HasMoves) {
                            const validMoves = getValidMoves(row, col);
                            player2HasMoves = validMoves.length > 0;
                        }
                    }
                } else {
                    // If there are covered pieces, the game is not over
                    return false;
                }
            }
        }
    }

    let winner = null;

    // Check winning conditions
    if (player1Pieces === 0 || !player1HasMoves) {
        winner = 2;
    } else if (player2Pieces === 0 || !player2HasMoves) {
        winner = 1;
    }

    if (winner) {
        gameState.gameOver = true;

        // Display winner message
        const winnerMessage = document.getElementById('winner-message');
        let resultText;
        if (gameState.cpuVsCpu) {
            resultText = `Player ${winner} Wins! (CPU vs CPU)`;
        } else if (gameState.cpuEnabled) {
            if (typeof aiLearning !== 'undefined') {
                aiLearning.recordGameResult(winner);
                const stats = aiLearning.getLearningSummary();
                resultText = winner === gameState.cpuPlayer
                    ? `CPU Wins! (Intelligence: ${stats.confidence}%)`
                    : `You Win! (CPU Intelligence: ${stats.confidence}%)`;
            } else {
                resultText = winner === gameState.cpuPlayer ? 'CPU Wins!' : 'You Win!';
            }
        } else {
            resultText = `Player ${winner} Wins!`;
        }
        debugLog(`Game over! Player ${winner} wins.`);
        showResult(resultText);
        return true;
    }

    return false;
}

function initGame() {
    setupEventListeners();
    showSetupScreen();
}

// ── Setup / game phase transitions ────────────────────────────────────────────

function showSetupScreen() {
    document.getElementById('setup-screen').style.display = '';
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('winner-message').style.display = 'none';
    syncSetupUI();
}

function syncSetupUI() {
    const p1Type = document.getElementById('p1-type');
    const p1Diff = document.getElementById('p1-difficulty');
    const p2Type = document.getElementById('p2-type');
    const p2Diff = document.getElementById('p2-difficulty');
    const speedSlider = document.getElementById('cpu-speed');
    const speedLabel  = document.getElementById('cpu-speed-label');

    if (p1Type) p1Type.value = gameState.player1.type;
    if (p1Diff) { p1Diff.value = gameState.player1.difficulty; p1Diff.disabled = gameState.player1.type !== 'cpu'; }
    if (p2Type) p2Type.value = gameState.player2.type;
    if (p2Diff) { p2Diff.value = gameState.player2.difficulty; p2Diff.disabled = gameState.player2.type !== 'cpu'; }
    if (speedSlider) speedSlider.value = gameState.cpuMoveDelay;
    if (speedLabel)  speedLabel.textContent = gameState.cpuMoveDelay === 0 ? '0ms' : `${(gameState.cpuMoveDelay / 1000).toFixed(1)}s`;
}

function startGame() {
    const p1Type = document.getElementById('p1-type').value;
    const p1Diff = document.getElementById('p1-difficulty').value;
    const p2Type = document.getElementById('p2-type').value;
    const p2Diff = document.getElementById('p2-difficulty').value;

    gameState.player1 = { type: p1Type, difficulty: p1Diff };
    gameState.player2 = { type: p2Type, difficulty: p2Diff };

    // Derive legacy CPU state flags used by cpu.js
    const bothCpu = p1Type === 'cpu' && p2Type === 'cpu';
    gameState.cpuVsCpu   = bothCpu;
    gameState.cpuEnabled = p1Type === 'cpu' || p2Type === 'cpu';
    gameState.cpuPlayer  = p2Type === 'cpu' ? 2 : 1;
    gameState.cpuDifficulty = p2Type === 'cpu' ? p2Diff : p1Diff;

    // Reset game state
    gameState.currentPlayer = 1;
    gameState.gameOver      = false;
    gameState.selectedCell  = null;
    gameState.validMoves    = [];
    gameState.validPushes   = [];
    gameState.cpuLastMoveFrom         = null;
    gameState.cpuLastMoveTo           = null;
    gameState.cpuRecentSquares        = {};
    gameState.cpuJustUncoveredHighValue = null;
    if (typeof gameLog !== 'undefined') gameLog.reset();

    initializeBoard();
    updateTurnIndicator();

    const resignBtn = document.getElementById('resign-button');
    if (resignBtn) resignBtn.textContent = bothCpu ? 'Stop' : 'Resign';

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('game-screen').style.display  = '';

    debugLog(`Game started: P1=${p1Type}${p1Type === 'cpu' ? ' ('+p1Diff+')' : ''} vs P2=${p2Type}${p2Type === 'cpu' ? ' ('+p2Diff+')' : ''}`);

    if (gameState.cpuVsCpu || (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer)) {
        setTimeout(makeCpuMove, 500);
    }
}

function resignGame() {
    if (gameState.gameOver) return;
    gameState.gameOver = true;

    const p1cpu = gameState.player1.type === 'cpu';
    const p2cpu = gameState.player2.type === 'cpu';
    let resultText;

    if (p1cpu && p2cpu) {
        resultText = 'Game stopped.';
    } else if (!p1cpu && !p2cpu) {
        const winner = gameState.currentPlayer === 1 ? 2 : 1;
        resultText = `Player ${winner} wins! (Player ${gameState.currentPlayer} resigned)`;
    } else {
        const humanPlayer = p1cpu ? 2 : 1;
        resultText = `CPU wins! (Player ${humanPlayer} resigned)`;
    }
    showResult(resultText);
}

function showResult(text) {
    document.getElementById('winner-text').textContent = text;
    document.getElementById('winner-message').style.display = 'flex';
    if (typeof gameLog !== 'undefined') gameLog.saveToStorage();
    clearValidMoves();
}

function restartGame() {
    // Re-use existing player config — no DOM reads needed
    document.getElementById('winner-message').style.display = 'none';
    const p1 = gameState.player1;
    const p2 = gameState.player2;
    const bothCpu = p1.type === 'cpu' && p2.type === 'cpu';
    gameState.cpuVsCpu   = bothCpu;
    gameState.cpuEnabled = p1.type === 'cpu' || p2.type === 'cpu';
    gameState.cpuPlayer  = p2.type === 'cpu' ? 2 : 1;
    gameState.cpuDifficulty = p2.type === 'cpu' ? p2.difficulty : p1.difficulty;
    gameState.currentPlayer = 1;
    gameState.gameOver      = false;
    gameState.selectedCell  = null;
    gameState.validMoves    = [];
    gameState.validPushes   = [];
    gameState.cpuLastMoveFrom         = null;
    gameState.cpuLastMoveTo           = null;
    gameState.cpuRecentSquares        = {};
    gameState.cpuJustUncoveredHighValue = null;
    if (typeof gameLog !== 'undefined') gameLog.reset();
    initializeBoard();
    updateTurnIndicator();
    const resignBtn = document.getElementById('resign-button');
    if (resignBtn) resignBtn.textContent = bothCpu ? 'Stop' : 'Resign';
    if (gameState.cpuVsCpu || (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer)) {
        setTimeout(makeCpuMove, 500);
    }
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
    document.getElementById('start-game-btn').addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', restartGame);
    document.getElementById('new-game-btn').addEventListener('click', showSetupScreen);
    document.getElementById('resign-button').addEventListener('click', resignGame);

    // Enable/disable difficulty selects based on player type
    ['p1', 'p2'].forEach(p => {
        const typeEl = document.getElementById(`${p}-type`);
        const diffEl = document.getElementById(`${p}-difficulty`);
        typeEl.addEventListener('change', () => { diffEl.disabled = typeEl.value !== 'cpu'; });
    });

    // Speed slider
    const speedSlider = document.getElementById('cpu-speed');
    const speedLabel  = document.getElementById('cpu-speed-label');
    speedSlider.addEventListener('input', () => {
        gameState.cpuMoveDelay = parseInt(speedSlider.value, 10);
        speedLabel.textContent = gameState.cpuMoveDelay === 0
            ? '0ms'
            : `${(gameState.cpuMoveDelay / 1000).toFixed(1)}s`;
    });
}
