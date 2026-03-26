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
        gameState.validMoves = getValidMoves(gameState, row, col);
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
            endTurn();
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
        checkGameOver();
        endTurn();
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
    const SPELL_ICON = '💨';
    const pushMoves = getPushMoves(gameState, dragonRow, dragonCol);
    return [
        { dr: -1, dc:  0, icon: '↑', label: 'Push Up' },
        { dr:  1, dc:  0, icon: '↓', label: 'Push Down' },
        { dr:  0, dc: -1, icon: '←', label: 'Push Left' },
        { dr:  0, dc:  1, icon: '→', label: 'Push Right' },
    ].map(({ dr, dc, icon, label }) => {
        const m = pushMoves.find(m => m.enemyR === dragonRow + dr && m.enemyC === dragonCol + dc);
        return {
            icon, label, spellIcon: SPELL_ICON,
            enabled: !!m,
            enemyRow: m?.enemyR, enemyCol: m?.enemyC,
            destRow: m?.destR,   destCol: m?.destC,
            action: m ? () => executePush(dragonRow, dragonCol, m.enemyR, m.enemyC, m.destR, m.destC) : null,
        };
    });
}

function getHopButtons(row, col) {
    const SPELL_ICON = '🐾';
    const hopMoves = getHopMoves(gameState, row, col);
    return [
        { dr: -1, dc:  0, icon: '↑', label: 'Hop Up' },
        { dr:  1, dc:  0, icon: '↓', label: 'Hop Down' },
        { dr:  0, dc: -1, icon: '←', label: 'Hop Left' },
        { dr:  0, dc:  1, icon: '→', label: 'Hop Right' },
    ].map(({ dr, dc, icon, label }) => {
        const m = hopMoves.find(m => m.toR === row + 2*dr && m.toC === col + 2*dc);
        return {
            icon, label, spellIcon: SPELL_ICON,
            enabled: !!m,
            destRow: m?.toR, destCol: m?.toC,
            action: m ? () => executeHop(row, col, m.toR, m.toC) : null,
        };
    });
}

function getRobotKittyButtons(row, col) {
    const SPELL_ICON = '🎯';
    const snipeMoves = getSnipeMoves(gameState, row, col);
    return [
        { dr: -1, dc:  0, icon: '↑', label: 'Snipe Up' },
        { dr:  1, dc:  0, icon: '↓', label: 'Snipe Down' },
        { dr:  0, dc: -1, icon: '←', label: 'Snipe Left' },
        { dr:  0, dc:  1, icon: '→', label: 'Snipe Right' },
    ].map(({ dr, dc, icon, label }) => {
        const m = snipeMoves.find(m => {
            const dR = m.targetR - row, dC = m.targetC - col;
            return (dR === 0 ? 0 : Math.sign(dR)) === dr && (dC === 0 ? 0 : Math.sign(dC)) === dc;
        });
        return {
            icon, label, spellIcon: SPELL_ICON,
            enabled: !!m,
            destCells: m ? [{ row: m.targetR, col: m.targetC }, { row: m.spotterR, col: m.spotterC }] : [],
            action: m ? () => executeRobotKitty(row, col, m.targetR, m.targetC) : null,
        };
    });
}

function getPyromaniaButtons(row, col) {
    const SPELL_ICON = '🔥';
    const pyroMoves = getPyroMoves(gameState, row, col);
    return [
        { dr: -1, dc:  0, icon: '↑', label: 'Ignite Up' },
        { dr:  1, dc:  0, icon: '↓', label: 'Ignite Down' },
        { dr:  0, dc: -1, icon: '←', label: 'Ignite Left' },
        { dr:  0, dc:  1, icon: '→', label: 'Ignite Right' },
    ].map(({ dr, dc, icon, label }) => {
        const m = pyroMoves.find(m => m.targetR === row + dr && m.targetC === col + dc);
        return {
            icon, label, spellIcon: SPELL_ICON,
            enabled: !!m,
            destRow: m?.targetR, destCol: m?.targetC,
            action: m ? () => executePyromania(row, col, m.targetR, m.targetC) : null,
        };
    });
}

function getEngulfButtons(row, col) {
    const piece = gameState.board[row][col];
    if (piece && piece.burning) {
        return [{ icon: '🔥', label: 'Already burning', spellIcon: '🔥', enabled: false, action: null }];
    }
    const enabled = getEngulfMoves(gameState, row, col).length > 0;
    return [{
        icon: '🔥', label: 'Engulf — go up in flames',
        spellIcon: '🔥',
        enabled,
        action: enabled ? () => executeEngulf(row, col) : null,
    }];
}

function getTransformButtons(row, col) {
    const SPELL_ICON = '🧙‍♂️';
    const transformMoves = getTransformMoves(gameState, row, col);
    const toRowCol = cells => cells.map(({ r, c }) => ({ row: r, col: c }));
    const buttons = [
        { dr: -1, dc:  0, icon: '↑', label: 'Transform Line Up' },
        { dr:  1, dc:  0, icon: '↓', label: 'Transform Line Down' },
        { dr:  0, dc: -1, icon: '←', label: 'Transform Line Left' },
        { dr:  0, dc:  1, icon: '→', label: 'Transform Line Right' },
    ].map(({ dr, dc, icon, label }) => {
        const m = transformMoves.find(m => !m.isExplosion && m.cells[1].r === row+dr && m.cells[1].c === col+dc);
        return {
            icon, label, spellIcon: SPELL_ICON,
            enabled: !!m,
            destCells: m ? toRowCol(m.cells) : [],
            action: m ? () => executeTransform(row, col, toRowCol(m.cells)) : null,
        };
    });
    const explodeMove = transformMoves.find(m => m.isExplosion);
    buttons.push({
        icon: '✦', label: 'Transform Explode', spellIcon: SPELL_ICON,
        enabled: !!explodeMove,
        destCells: explodeMove ? toRowCol(explodeMove.cells) : [],
        action: explodeMove ? () => executeTransform(row, col, toRowCol(explodeMove.cells), true) : null,
    });
    return buttons;
}

function buildSkillButtons(piece, row, col) {
    if (!piece) return [];
    const enabled = gameState.enabledAbilities;

    // Burning piece: override normal abilities with pyromania spread buttons
    if (piece.burning) {
        if (!enabled.has('pyromania')) return [];
        return getPyromaniaButtons(row, col).slice(0, SKILL_TRAY_SLOTS);
    }

    // Non-burning piece: normal abilities
    if (!PIECE_ABILITIES[piece.type]) return [];
    const buttons = [];
    for (const abilityId of PIECE_ABILITIES[piece.type]) {
        if (!enabled.has(abilityId)) continue;
        if (abilityId === 'push')      buttons.push(...getPushButtons(row, col));
        if (abilityId === 'engulf')    buttons.push(...getEngulfButtons(row, col));
        if (abilityId === 'hop')       buttons.push(...getHopButtons(row, col));
        if (abilityId === 'transform') buttons.push(...getTransformButtons(row, col));
        if (abilityId === 'snipe')     buttons.push(...getRobotKittyButtons(row, col));
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
                // Preview destination(s) on hover
                const previewCells = b.destCells
                    || (b.destRow !== undefined ? [{ row: b.destRow, col: b.destCol }] : []);
                slot.onmouseenter = () => {
                    previewCells.forEach(({ row, col }) => {
                        const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                        if (el) el.classList.add('push-destination-preview');
                    });
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

// ── Turn engine ───────────────────────────────────────────────────────────────
// Single point of truth for advancing the game after any move (human or CPU).
// execute* functions handle mechanics then call endTurn(); no turn logic elsewhere.
function endTurn() {
    if (gameState.gameOver) return;
    gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
    updateTurnIndicator();
    scheduleNextCpuMoveIfNeeded();
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
    endTurn();
}

function executeTransform(wizRow, wizCol, mouseCells, isExplosion = false) {
    const player = gameState.board[wizRow][wizCol].player;
    const newMouse = () => ({ type: 'mouse', power: 1, player, emoji: '🐭' });

    // Clear wizard cell
    gameState.board[wizRow][wizCol] = null;
    const wizEl = document.querySelector(`.cell[data-row="${wizRow}"][data-col="${wizCol}"]`);
    wizEl.textContent = '';
    wizEl.style.backgroundColor = '#e0c9a6';
    wizEl.classList.remove('selected');

    // Place mice
    for (const { row, col } of mouseCells) {
        gameState.board[row][col] = newMouse();
        gameState.covered[row][col] = false;
        const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        el.textContent = '🐭';
        el.style.backgroundColor = PLAYER_COLORS[player];
        el.classList.remove('covered');
    }

    if (typeof gameLog !== 'undefined') gameLog.recordTransform(gameState.currentPlayer, wizRow, wizCol, mouseCells);

    clearValidMoves();
    clearSkillTray();
    gameState.selectedCell = null;

    checkGameOver();
    endTurn();
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
    endTurn();
}

function flyRobot(fromEl, toEl, playerColor, emoji, onComplete) {
    if (!fromEl || !toEl) { onComplete(); return; }

    const rRect = fromEl.getBoundingClientRect();
    const tRect = toEl.getBoundingClientRect();

    // Clone that flies across the screen
    const flyer = document.createElement('div');
    flyer.textContent = emoji;
    Object.assign(flyer.style, {
        position:       'fixed',
        left:           rRect.left + 'px',
        top:            rRect.top  + 'px',
        width:          rRect.width  + 'px',
        height:         rRect.height + 'px',
        fontSize:       '30px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        backgroundColor: playerColor,
        borderRadius:   '4px',
        zIndex:         '1000',
        pointerEvents:  'none',
    });
    document.body.appendChild(flyer);

    // Immediately clear the source cell
    fromEl.textContent = '';
    fromEl.style.backgroundColor = '#e0c9a6';

    const dx = tRect.left - rRect.left;
    const dy = tRect.top  - rRect.top;

    // Fly: squish narrow at mid-flight, return to normal on landing
    const anim = flyer.animate([
        { transform: 'translate(0px, 0px) scaleX(1) scaleY(1)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scaleX(0.15) scaleY(1.6)`,
          offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scaleX(1) scaleY(1)` },
    ], { duration: 360, easing: 'ease-in-out', fill: 'forwards' });

    anim.onfinish = () => { flyer.remove(); onComplete(); };
}

function executeRobotKitty(robotRow, robotCol, targetRow, targetCol) {
    const robot    = gameState.board[robotRow][robotCol];
    const captured = gameState.board[targetRow][targetCol];

    // Update board state immediately
    gameState.board[robotRow][robotCol]     = null;
    gameState.board[targetRow][targetCol]   = robot;
    gameState.covered[targetRow][targetCol] = false;

    debugLog(`P${gameState.currentPlayer} robot zoomed to capture ${captured.type} at (${targetRow},${targetCol})`);
    if (typeof gameLog !== 'undefined') gameLog.recordSnipe(gameState.currentPlayer, robotRow, robotCol, targetRow, targetCol, captured);

    clearValidMoves();
    clearSkillTray();
    gameState.selectedCell = null;

    const robotEl  = document.querySelector(`.cell[data-row="${robotRow}"][data-col="${robotCol}"]`);
    const targetEl = document.querySelector(`.cell[data-row="${targetRow}"][data-col="${targetCol}"]`);
    if (robotEl) robotEl.classList.remove('selected');

    // Fly the robot — enemy piece stays visible until robot lands
    flyRobot(robotEl, targetEl, PLAYER_COLORS[robot.player], robot.emoji, () => {
        // Land: replace captured piece with robot
        if (targetEl) {
            targetEl.textContent = robot.emoji;
            targetEl.style.backgroundColor = PLAYER_COLORS[robot.player];
            targetEl.classList.remove('covered', 'valid-move', 'valid-capture', 'burning');
        }
        checkGameOver();
        endTurn();
    });
}

function executeEngulf(row, col) {
    const piece = gameState.board[row][col];
    piece.burning = true;

    const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (el) { el.classList.add('burning'); el.classList.remove('selected'); }

    if (typeof gameLog !== 'undefined') gameLog.recordEngulf(gameState.currentPlayer, row, col);

    clearValidMoves();
    clearSkillTray();
    gameState.selectedCell = null;

    endTurn();
}

function executePyromania(burnerRow, burnerCol, targetRow, targetCol) {
    const burner = gameState.board[burnerRow][burnerCol];
    const target = gameState.board[targetRow][targetCol];

    // Set target on fire (must already be uncovered)
    target.burning = true;
    const targetEl = document.querySelector(`.cell[data-row="${targetRow}"][data-col="${targetCol}"]`);
    if (targetEl) targetEl.classList.add('burning');

    // Spreading fire costs the burner 1 power
    burner.power--;
    const burnerEl = document.querySelector(`.cell[data-row="${burnerRow}"][data-col="${burnerCol}"]`);
    if (burner.power <= 0) {
        gameState.board[burnerRow][burnerCol] = null;
        if (burnerEl) {
            burnerEl.textContent = '';
            burnerEl.style.backgroundColor = '#e0c9a6';
            burnerEl.classList.remove('burning', 'selected');
        }
    } else {
        const lvl = BURN_LEVEL[burner.power];
        burner.type  = lvl.type;
        burner.emoji = lvl.emoji;
        if (burnerEl) burnerEl.textContent = burner.emoji;
    }

    if (typeof gameLog !== 'undefined') gameLog.recordPyromania(gameState.currentPlayer, burnerRow, burnerCol, targetRow, targetCol, target);

    clearValidMoves();
    clearSkillTray();
    if (burnerEl) burnerEl.classList.remove('selected');
    gameState.selectedCell = null;

    checkGameOver();
    endTurn();
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
                            const validMoves = getValidMoves(gameState, row, col);
                            player1HasMoves = validMoves.length > 0;
                        }
                    } else {
                        player2Pieces++;
                        if (!player2HasMoves) {
                            const validMoves = getValidMoves(gameState, row, col);
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

        let resultText, scoreText;
        if (gameState.cpuVsCpu) {
            resultText = `Player ${winner} Wins! (CPU vs CPU)`;
            scoreText = `Score: ${calcPowerScore(winner)}`;
        } else if (gameState.cpuEnabled) {
            const humanPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
            const diff = gameState.cpuDifficulty;
            const diffLabel = diff.charAt(0).toUpperCase() + diff.slice(1);
            const humanWon = winner === humanPlayer;
            if (typeof aiLearning !== 'undefined') {
                aiLearning.recordGameResult(winner);
            }
            resultText = humanWon ? 'You Win!' : 'CPU Wins!';
            scoreText = `Score: ${humanWon ? calcPowerScore(humanPlayer) : 0} · vs ${diffLabel} CPU`;
        } else {
            resultText = `Player ${winner} Wins!`;
            scoreText = `Score: ${calcPowerScore(winner)}`;
        }
        debugLog(`Game over! Player ${winner} wins.`);
        showResult(resultText, scoreText);
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

    // Read ability toggles
    gameState.enabledAbilities = new Set(
        Array.from(document.querySelectorAll('.ability-toggle:checked')).map(cb => cb.value)
    );

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
    if (typeof gameLog !== 'undefined') gameLog.recordInitialBoard();
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
    let resultText, scoreText;

    if (p1cpu && p2cpu) {
        resultText = 'Game stopped.';
        scoreText = '';
    } else if (!p1cpu && !p2cpu) {
        const winner = gameState.currentPlayer === 1 ? 2 : 1;
        resultText = `Player ${winner} wins! (Player ${gameState.currentPlayer} resigned)`;
        scoreText = 'Score: 0';
    } else {
        const diff = gameState.cpuDifficulty;
        const diffLabel = diff.charAt(0).toUpperCase() + diff.slice(1);
        resultText = 'CPU wins! (You resigned)';
        scoreText = `Score: 0 · vs ${diffLabel} CPU`;
    }
    showResult(resultText, scoreText);
}

function calcPowerScore(player) {
    let score = 0;
    for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = gameState.board[r][c];
            if (p && p.player === player) score += p.power;
        }
    return score;
}

function showResult(text, scoreText) {
    document.getElementById('winner-text').textContent = text;
    const scoreEl = document.getElementById('winner-score');
    if (scoreEl) scoreEl.textContent = scoreText || '';
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
    if (typeof gameLog !== 'undefined') gameLog.recordInitialBoard();
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

    // Enable/disable difficulty selects based on player type; show speed row only for CPU vs CPU
    const speedRow = document.getElementById('speed-row');
    function updateSpeedRow() {
        const bothCpu = document.getElementById('p1-type').value === 'cpu' &&
                        document.getElementById('p2-type').value === 'cpu';
        speedRow.style.display = bothCpu ? '' : 'none';
    }
    ['p1', 'p2'].forEach(p => {
        const typeEl = document.getElementById(`${p}-type`);
        const diffEl = document.getElementById(`${p}-difficulty`);
        typeEl.addEventListener('change', () => {
            diffEl.disabled = typeEl.value !== 'cpu';
            updateSpeedRow();
        });
    });
    updateSpeedRow();

    // Speed slider
    const speedSlider = document.getElementById('cpu-speed');
    const speedLabel  = document.getElementById('cpu-speed-label');
    speedSlider.addEventListener('input', () => {
        gameState.cpuMoveDelay = parseInt(speedSlider.value, 10);
        speedLabel.textContent = gameState.cpuMoveDelay === 0
            ? '0ms'
            : `${(gameState.cpuMoveDelay / 1000).toFixed(1)}s`;
    });

    // Abilities count in collapsed summary
    function updateAbilitiesCount() {
        const total   = document.querySelectorAll('.ability-toggle').length;
        const checked = document.querySelectorAll('.ability-toggle:checked').length;
        const el = document.getElementById('abilities-count');
        if (el) el.textContent = `(${checked} / ${total})`;
    }
    document.querySelectorAll('.ability-toggle').forEach(cb => {
        cb.addEventListener('change', updateAbilitiesCount);
    });
    updateAbilitiesCount();
}
