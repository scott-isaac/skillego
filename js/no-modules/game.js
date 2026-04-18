// game.js - Core game logic

function handleCellClick(row, col, cellElement) {
    debugLog(`handleCellClick called at (${row}, ${col})`);
    
    // If the game is over or it's CPU's turn, ignore clicks
    if (gameState.gameOver) {
        debugLog("Ignoring click - game is over");
        return;
    }

    // In server mode: only allow clicks when it's our player's turn
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        if (gameState.currentPlayer !== serverMode.playerNumber) return;
    } else {
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
        // In 4-player mode, ignore clicks when it's a CPU player's turn
        if (gameState.numPlayers > 2) {
            const cfg = gameState[`player${gameState.currentPlayer}`];
            if (cfg && cfg.type === 'cpu') {
                debugLog("Ignoring click during CPU turn (4P)");
                return;
            }
        }
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
            if (typeof serverMode !== 'undefined' && serverMode.active) {
                const target = gameState.board[row][col];
                serverMode.sendMove({
                    type:  target ? 'capture' : 'move',
                    fromR: gameState.selectedCell.row, fromC: gameState.selectedCell.col,
                    toR:   row, toC: col,
                });
            } else {
                movePiece(gameState.selectedCell.row, gameState.selectedCell.col, row, col);
                endTurn();
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
        executeUncover(row, col);
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
    const pushMoves = getPushMoves(gameState, dragonRow, dragonCol, gameState.enabledAbilities);
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
    const hopMoves = getHopMoves(gameState, row, col, gameState.enabledAbilities);
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
    const snipeMoves = getSnipeMoves(gameState, row, col, gameState.enabledAbilities);
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
    const pyroMoves = getPyroMoves(gameState, row, col, gameState.enabledAbilities);
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
    const enabled = getEngulfMoves(gameState, row, col, gameState.enabledAbilities).length > 0;
    return [{
        icon: '🔥', label: 'Engulf — go up in flames',
        spellIcon: '🔥',
        enabled,
        action: enabled ? () => executeEngulf(row, col) : null,
    }];
}

function getTransformButtons(row, col) {
    const SPELL_ICON = '🧙‍♂️';
    const transformMoves = getTransformMoves(gameState, row, col, gameState.enabledAbilities);
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
    const n = gameState.numPlayers || 2;
    let next = (gameState.currentPlayer % n) + 1;
    let safety = 0;
    while (gameState.eliminatedPlayers && gameState.eliminatedPlayers.has(next) && safety++ < n) {
        next = (next % n) + 1;
    }
    gameState.currentPlayer = next;
    updateTurnIndicator();
    scheduleNextCpuMoveIfNeeded();
}

function executeUncover(row, col) {
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.sendMove({ type: 'uncover', r: row, c: col });
        return;
    }
    const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    const piece = gameState.board[row][col];
    if (!el || !piece) return;
    showLastMove([{ row, col }]);
    el.style.transition = 'none';
    gameState.covered[row][col] = false;
    renderCell(el, piece, false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = '';
    }));
    if (typeof gameLog !== 'undefined') gameLog.recordUncover(gameState.currentPlayer, row, col, piece);
    checkGameOver();
    endTurn();
}

function executeHop(mouseRow, mouseCol, destRow, destCol) {
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.sendMove({ type: 'hop', fromR: mouseRow, fromC: mouseCol, toR: destRow, toC: destCol });
        return;
    }
    const mouse = gameState.board[mouseRow][mouseCol];

    showLastMove([{ row: mouseRow, col: mouseCol }, { row: destRow, col: destCol }]);
    gameState.board[destRow][destCol] = mouse;
    gameState.board[mouseRow][mouseCol] = null;
    gameState.covered[destRow][destCol] = false;

    const fromEl = document.querySelector(`.cell[data-row="${mouseRow}"][data-col="${mouseCol}"]`);
    const toEl   = document.querySelector(`.cell[data-row="${destRow}"][data-col="${destCol}"]`);
    renderCell(fromEl, null, false);
    hopPiece(fromEl, toEl, mouse, () => renderCell(toEl, mouse, false));

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
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.sendMove({ type: 'transform', wizR: wizRow, wizC: wizCol,
            cells: mouseCells.map(({ row, col }) => ({ r: row, c: col })), isExplosion: !!isExplosion });
        return;
    }
    const player = gameState.board[wizRow][wizCol].player;
    showLastMove([{ row: wizRow, col: wizCol }, ...mouseCells]);
    const newMouse = () => ({ type: 'mouse', power: 1, player, emoji: '🐭' });

    // Clear wizard cell
    gameState.board[wizRow][wizCol] = null;
    const wizEl = document.querySelector(`.cell[data-row="${wizRow}"][data-col="${wizCol}"]`);
    wizEl.classList.remove('selected');
    renderCell(wizEl, null, false);

    // Place mice
    for (const { row, col } of mouseCells) {
        gameState.board[row][col] = newMouse();
        gameState.covered[row][col] = false;
        const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        renderCell(el, gameState.board[row][col], false);
    }

    if (typeof gameLog !== 'undefined') gameLog.recordTransform(gameState.currentPlayer, wizRow, wizCol, mouseCells);

    clearValidMoves();
    clearSkillTray();
    gameState.selectedCell = null;

    checkGameOver();
    endTurn();
}

function executePush(dragonRow, dragonCol, enemyRow, enemyCol, destRow, destCol) {
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.sendMove({ type: 'push', drR: dragonRow, drC: dragonCol,
            enemyR: enemyRow, enemyC: enemyCol, destR: destRow, destC: destCol });
        return;
    }
    const enemy = gameState.board[enemyRow][enemyCol];

    showLastMove([{ row: dragonRow, col: dragonCol }, { row: enemyRow, col: enemyCol }, { row: destRow, col: destCol }]);
    gameState.board[destRow][destCol] = enemy;
    gameState.board[enemyRow][enemyCol] = null;
    gameState.covered[destRow][destCol] = false;

    const fromEl = document.querySelector(`.cell[data-row="${enemyRow}"][data-col="${enemyCol}"]`);
    const toEl   = document.querySelector(`.cell[data-row="${destRow}"][data-col="${destCol}"]`);
    renderCell(fromEl, null, false);
    renderCell(toEl, enemy, false);

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

function flyRobot(fromEl, toEl, piece, onComplete) {
    if (!fromEl || !toEl || !gameState.animationsEnabled) { onComplete(); return; }

    const board = document.getElementById('board');
    const color = PLAYER_ART[piece.player];

    const flyer = document.createElement('div');
    Object.assign(flyer.style, {
        position:           'absolute',
        left:               fromEl.offsetLeft + 'px',
        top:                fromEl.offsetTop  + 'px',
        width:              fromEl.offsetWidth  + 'px',
        height:             fromEl.offsetHeight + 'px',
        backgroundImage:    `url('assets/piece_${piece.type}.png'), url('assets/player_${color}.png')`,
        backgroundSize:     '65% 65%, 85% 85%',
        backgroundRepeat:   'no-repeat',
        backgroundPosition: 'center',
        zIndex:             '1000',
        pointerEvents:      'none',
        willChange:         'transform',
    });
    board.appendChild(flyer);

    // Immediately clear the source cell
    renderCell(fromEl, null, false);

    const dx = toEl.offsetLeft - fromEl.offsetLeft;
    const dy = toEl.offsetTop  - fromEl.offsetTop;

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
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.sendMove({ type: 'snipe', robotR: robotRow, robotC: robotCol,
            targetR: targetRow, targetC: targetCol });
        return;
    }
    const robot    = gameState.board[robotRow][robotCol];
    const captured = gameState.board[targetRow][targetCol];

    showLastMove([{ row: robotRow, col: robotCol }, { row: targetRow, col: targetCol }]);
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
    flyRobot(robotEl, targetEl, robot, () => {
        // Land: replace captured piece with robot
        if (targetEl) {
            targetEl.classList.remove('valid-move', 'valid-capture');
            renderCell(targetEl, robot, false);
        }
        checkGameOver();
        endTurn();
    });
}

function executeEngulf(row, col) {
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.sendMove({ type: 'engulf', r: row, c: col });
        return;
    }
    const piece = gameState.board[row][col];
    piece.burning = true;

    showLastMove([{ row, col }]);
    const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (el) { el.classList.remove('selected'); renderCell(el, piece, false); }

    if (typeof gameLog !== 'undefined') gameLog.recordEngulf(gameState.currentPlayer, row, col);

    clearValidMoves();
    clearSkillTray();
    gameState.selectedCell = null;

    endTurn();
}

function executePyromania(burnerRow, burnerCol, targetRow, targetCol) {
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.sendMove({ type: 'pyro', fromR: burnerRow, fromC: burnerCol,
            targetR: targetRow, targetC: targetCol });
        return;
    }
    const burner = gameState.board[burnerRow][burnerCol];
    const target = gameState.board[targetRow][targetCol];

    showLastMove([{ row: burnerRow, col: burnerCol }, { row: targetRow, col: targetCol }]);
    // Set target on fire (must already be uncovered)
    target.burning = true;
    const targetEl = document.querySelector(`.cell[data-row="${targetRow}"][data-col="${targetCol}"]`);
    if (targetEl) renderCell(targetEl, target, false);

    // Spreading fire costs the burner 1 power
    burner.power--;
    const burnerEl = document.querySelector(`.cell[data-row="${burnerRow}"][data-col="${burnerCol}"]`);
    if (burner.power <= 0) {
        gameState.board[burnerRow][burnerCol] = null;
        if (burnerEl) {
            burnerEl.classList.remove('selected');
            renderCell(burnerEl, null, false);
        }
    } else {
        const lvl = BURN_LEVEL[burner.power];
        burner.type  = lvl.type;
        burner.emoji = lvl.emoji;
        if (burnerEl) renderCell(burnerEl, burner, false);
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
    // Any covered piece means game still in progress
    for (let row = 0; row < BOARD_ROWS; row++)
        for (let col = 0; col < BOARD_COLS; col++)
            if (gameState.covered[row][col]) return false;

    const n = gameState.numPlayers || 2;
    const pieceCounts = {};
    const hasMoves = {};
    for (let p = 1; p <= n; p++) {
        if (gameState.eliminatedPlayers.has(p)) continue;
        pieceCounts[p] = 0;
        hasMoves[p] = false;
    }

    for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
            const piece = gameState.board[row][col];
            if (!piece) continue;
            const p = piece.player;
            if (pieceCounts[p] !== undefined) {
                pieceCounts[p]++;
                if (!hasMoves[p] && getValidMoves(gameState, row, col).length > 0)
                    hasMoves[p] = true;
            }
        }
    }

    // Eliminate players with no pieces or no moves
    for (let p = 1; p <= n; p++) {
        if (gameState.eliminatedPlayers.has(p)) continue;
        if (pieceCounts[p] === 0 || !hasMoves[p]) {
            gameState.eliminatedPlayers.add(p);
            debugLog(`Player ${p} eliminated`);
        }
    }

    // Count survivors
    const survivors = [];
    for (let p = 1; p <= n; p++) {
        if (!gameState.eliminatedPlayers.has(p)) survivors.push(p);
    }

    if (survivors.length > 1) return false;

    gameState.gameOver = true;
    const winner = survivors[0] ?? null;

    let resultText, scoreText;
    if (!winner) {
        resultText = 'Draw!';
        scoreText = 'Score: 0';
    } else if (n === 4) {
        resultText = `Player ${winner} Wins!`;
        scoreText  = `Score: ${calcPowerScore(winner)}`;
    } else if (gameState.cpuEnabled) {
        const humanPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
        const diff = gameState.cpuDifficulty;
        const diffLabel = diff.charAt(0).toUpperCase() + diff.slice(1);
        const humanWon = winner === humanPlayer;
        if (typeof aiLearning !== 'undefined') aiLearning.recordGameResult(winner);
        resultText = humanWon ? 'You Win!' : 'CPU Wins!';
        scoreText  = `Score: ${humanWon ? calcPowerScore(humanPlayer) : 0} · vs ${diffLabel} CPU`;
    } else {
        resultText = `Player ${winner} Wins!`;
        scoreText  = `Score: ${calcPowerScore(winner)}`;
    }

    debugLog(`Game over! Player ${winner} wins.`);
    // Auto-save game log to server for learning
    if (typeof gameLog !== 'undefined') gameLog.saveToServer();
    showResult(resultText, scoreText);
    return true;
}

function initGame() {
    setupEventListeners();
    showSetupScreen();
}

// ── Setup / game phase transitions ────────────────────────────────────────────

function showSetupScreen() {
    document.getElementById('setup-screen').style.display = '';
    document.getElementById('winner-message').style.display = 'none';
    document.getElementById('rules-overlay').style.display = 'none';
    document.getElementById('resign-button').style.display = 'none';
    document.getElementById('help-button').style.display = 'none';
    document.getElementById('turn-indicator').style.display = 'none';
    // Collapse How to Play and Abilities if they were left open
    document.querySelectorAll('#setup-screen details[open]').forEach(function(d) { d.removeAttribute('open'); });
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

    const numPlayersSelect = document.getElementById('num-players-select');
    if (numPlayersSelect) numPlayersSelect.value = gameState.numPlayers;

    const p3TypeEl = document.getElementById('p3-type-select');
    const p3DiffEl = document.getElementById('p3-diff-select');
    const p4TypeEl = document.getElementById('p4-type-select');
    const p4DiffEl = document.getElementById('p4-diff-select');
    if (p3TypeEl) p3TypeEl.value = gameState.player3.type;
    if (p3DiffEl) p3DiffEl.value = gameState.player3.difficulty;
    if (p4TypeEl) p4TypeEl.value = gameState.player4.type;
    if (p4DiffEl) p4DiffEl.value = gameState.player4.difficulty;

    const p3Row = document.getElementById('player3-row');
    const p4Row = document.getElementById('player4-row');
    if (p3Row) p3Row.style.display = gameState.numPlayers >= 3 ? '' : 'none';
    if (p4Row) p4Row.style.display = gameState.numPlayers >= 4 ? '' : 'none';
}

function startGame() {
    const p1Type = document.getElementById('p1-type').value;
    const p1Diff = document.getElementById('p1-difficulty').value;
    const p2Type = document.getElementById('p2-type').value;
    const p2Diff = document.getElementById('p2-difficulty').value;

    gameState.player1 = { type: p1Type, difficulty: p1Diff };
    gameState.player2 = { type: p2Type, difficulty: p2Diff };

    // Read numPlayers
    const numPlayersEl = document.getElementById('num-players-select');
    if (numPlayersEl) gameState.numPlayers = parseInt(numPlayersEl.value) || 2;

    // Read P3/P4 configs
    if (gameState.numPlayers >= 3) {
        gameState.player3 = {
            type: document.getElementById('p3-type-select')?.value || 'cpu',
            difficulty: document.getElementById('p3-diff-select')?.value || 'expert',
        };
    }
    if (gameState.numPlayers >= 4) {
        gameState.player4 = {
            type: document.getElementById('p4-type-select')?.value || 'cpu',
            difficulty: document.getElementById('p4-diff-select')?.value || 'expert',
        };
    }

    // Read ability toggles
    gameState.enabledAbilities = new Set(
        Array.from(document.querySelectorAll('.ability-toggle:checked')).map(cb => cb.value)
    );

    // Derive legacy CPU state flags used by cpu.js (2-player path)
    const bothCpu = p1Type === 'cpu' && p2Type === 'cpu';
    gameState.cpuVsCpu   = bothCpu;
    gameState.cpuEnabled = p1Type === 'cpu' || p2Type === 'cpu';
    gameState.cpuPlayer  = p2Type === 'cpu' ? 2 : 1;
    gameState.cpuDifficulty = p2Type === 'cpu' ? p2Diff : p1Diff;

    // 4-player mode bypasses legacy cpuEnabled/cpuVsCpu paths
    if (gameState.numPlayers > 2) {
        gameState.cpuEnabled = false;
        gameState.cpuVsCpu = false;
        // scheduleNextCpuMoveIfNeeded uses per-player config instead
    }

    // Reset game state
    gameState.currentPlayer = 1;
    gameState.gameOver      = false;
    gameState.selectedCell  = null;
    gameState.validMoves    = [];
    gameState.validPushes   = [];
    gameState.cpuLastMoveFrom         = null;
    gameState.cpuLastMoveTo           = null;
    gameState.cpuRecentSquares        = {};
    gameState.eliminatedPlayers = new Set();
    if (typeof gameLog !== 'undefined') gameLog.reset();

    const boardCfg = BOARD_CONFIG[gameState.numPlayers] || BOARD_CONFIG[2];
    BOARD_ROWS = boardCfg.rows;
    BOARD_COLS = boardCfg.cols;

    // In server mode: send config to server, create the DOM board shell, then wait.
    // The server will send back game-started with the authoritative board state.
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        initializeBoard();  // creates DOM cells; state overwritten by server on game-started
        const playerConfigs = {};
        for (let p = 1; p <= gameState.numPlayers; p++) {
            playerConfigs[p] = { ...gameState[`player${p}`] };
        }
        serverMode.createGame({
            numPlayers:       gameState.numPlayers,
            playerConfigs,
            enabledAbilities: [...gameState.enabledAbilities],
        });
        return; // _showGameScreen() is called when server emits game-started
    }

    // ── Local / standalone mode ───────────────────────────────────────────────
    initializeBoard();
    if (typeof gameLog !== 'undefined') gameLog.recordInitialBoard();
    updateTurnIndicator();

    const resignBtn = document.getElementById('resign-button');
    const allCpu = Array.from({ length: gameState.numPlayers }, (_, i) => gameState[`player${i + 1}`]?.type === 'cpu').every(Boolean);
    if (resignBtn) resignBtn.textContent = allCpu ? 'Stop' : 'Resign';

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('resign-button').style.display = '';
    document.getElementById('help-button').style.display = '';
    document.getElementById('turn-indicator').style.display = '';

    // Show in-game speed control whenever >1 CPU is playing
    const activeCpuCount = [gameState.player1, gameState.player2, gameState.player3, gameState.player4]
        .filter((p, i) => i < gameState.numPlayers && p && p.type === 'cpu').length;
    const gameSpeedRow = document.getElementById('speed-overlay');
    if (gameSpeedRow) gameSpeedRow.style.display = activeCpuCount > 1 ? '' : 'none';

    debugLog(`Game started: ${gameState.numPlayers}P mode`);

    scheduleNextCpuMoveIfNeeded();
}

function resignGame() {
    if (gameState.gameOver) return;

    // In server mode, tell the server — it will broadcast game-over to both players
    if (typeof serverMode !== 'undefined' && serverMode.active) {
        serverMode.socket.emit('resign', {
            gameId: serverMode.gameId,
            token:  serverMode.token,
        });
        return;
    }

    // Local mode
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
    for (let r = 0; r < BOARD_ROWS; r++)
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = gameState.board[r][c];
            if (p && p.player === player) score += p.power;
        }
    return score;
}

function showResult(text, scoreText) {
    document.getElementById('winner-text').textContent = text;
    const scoreEl = document.getElementById('winner-score');
    const moves = typeof gameLog !== 'undefined' ? Math.ceil(gameLog.turnNumber / 2) : 0;
    const movesLabel = moves > 0 ? ` · ${moves} moves` : '';
    if (scoreEl) scoreEl.textContent = (scoreText || '') + movesLabel;
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
    gameState.cpuVsCpu   = bothCpu && gameState.numPlayers === 2;
    gameState.cpuEnabled = (p1.type === 'cpu' || p2.type === 'cpu') && gameState.numPlayers === 2;
    gameState.cpuPlayer  = p2.type === 'cpu' ? 2 : 1;
    gameState.cpuDifficulty = p2.type === 'cpu' ? p2.difficulty : p1.difficulty;
    if (gameState.numPlayers > 2) {
        gameState.cpuEnabled = false;
        gameState.cpuVsCpu = false;
    }
    gameState.currentPlayer = 1;
    gameState.gameOver      = false;
    gameState.selectedCell  = null;
    gameState.validMoves    = [];
    gameState.validPushes   = [];
    gameState.cpuLastMoveFrom         = null;
    gameState.cpuLastMoveTo           = null;
    gameState.cpuRecentSquares        = {};
    gameState.eliminatedPlayers = new Set();
    if (typeof gameLog !== 'undefined') gameLog.reset();
    const boardCfg = BOARD_CONFIG[gameState.numPlayers] || BOARD_CONFIG[2];
    BOARD_ROWS = boardCfg.rows;
    BOARD_COLS = boardCfg.cols;
    initializeBoard();
    if (typeof gameLog !== 'undefined') gameLog.recordInitialBoard();
    updateTurnIndicator();
    const resignBtn = document.getElementById('resign-button');
    const allCpu = Array.from({ length: gameState.numPlayers }, (_, i) => gameState[`player${i + 1}`]?.type === 'cpu').every(Boolean);
    if (resignBtn) resignBtn.textContent = allCpu ? 'Stop' : 'Resign';
    const activeCpuCount2 = [gameState.player1, gameState.player2, gameState.player3, gameState.player4]
        .filter((p, i) => i < gameState.numPlayers && p && p.type === 'cpu').length;
    const gameSpeedRow2 = document.getElementById('speed-overlay');
    if (gameSpeedRow2) gameSpeedRow2.style.display = activeCpuCount2 > 1 ? '' : 'none';
    scheduleNextCpuMoveIfNeeded();
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
    document.getElementById('start-game-btn').addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', restartGame);
    document.getElementById('new-game-btn').addEventListener('click', showSetupScreen);
    document.getElementById('resign-button').addEventListener('click', resignGame);

    // Enable/disable difficulty selects based on player type; show speed row when >1 CPU configured
    const speedRow = document.getElementById('speed-row');
    function countSetupCpus() {
        let n = 0;
        if (document.getElementById('p1-type')?.value === 'cpu') n++;
        if (document.getElementById('p2-type')?.value === 'cpu') n++;
        const p3Row = document.getElementById('player3-row');
        if (p3Row && p3Row.style.display !== 'none' && document.getElementById('p3-type-select')?.value === 'cpu') n++;
        const p4Row = document.getElementById('player4-row');
        if (p4Row && p4Row.style.display !== 'none' && document.getElementById('p4-type-select')?.value === 'cpu') n++;
        return n;
    }
    function updateSpeedRow() {
        speedRow.style.display = countSetupCpus() > 1 ? '' : 'none';
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

    const numPlayersSelect = document.getElementById('num-players-select');
    if (numPlayersSelect) {
        numPlayersSelect.addEventListener('change', () => {
            const n = parseInt(numPlayersSelect.value);
            document.getElementById('player3-row').style.display = n >= 3 ? '' : 'none';
            document.getElementById('player4-row').style.display = n >= 4 ? '' : 'none';
            updateSpeedRow();
            if (typeof updateAbilitiesCount === 'function') updateAbilitiesCount();
        });
    }

    // Wire P3/P4 type selects to updateSpeedRow
    ['p3-type-select', 'p4-type-select'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', updateSpeedRow);
    });

    // Speed sliders — setup screen + in-game share the same cpuMoveDelay
    function applySpeed(val) {
        gameState.cpuMoveDelay = parseInt(val, 10);
        gameState.animationsEnabled = gameState.cpuMoveDelay >= 200;
        const label = gameState.cpuMoveDelay === 0 ? '0ms' : `${(gameState.cpuMoveDelay / 1000).toFixed(1)}s`;
        document.querySelectorAll('.cpu-speed-label').forEach(el => el.textContent = label);
        document.querySelectorAll('.cpu-speed-slider').forEach(el => el.value = val);
    }
    document.querySelectorAll('.cpu-speed-slider').forEach(slider => {
        slider.addEventListener('input', () => applySpeed(slider.value));
    });

    // Abilities count in collapsed summary
    function updateAbilitiesCount() {
        const total   = document.querySelectorAll('.ability-toggle').length;
        const checked = document.querySelectorAll('.ability-toggle:checked').length;
        const el = document.getElementById('abilities-count');
        if (el) el.textContent = `(${checked} / ${total} selected)`;
    }
    document.querySelectorAll('.ability-toggle').forEach(cb => {
        cb.addEventListener('change', updateAbilitiesCount);
    });
    updateAbilitiesCount();
}
