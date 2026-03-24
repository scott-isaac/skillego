// cpu.js - CPU AI logic

// Schedule the next CPU move if the game is in a state where a CPU should move.
// Used by all turn-ending paths to keep CPU vs CPU games auto-advancing.
function scheduleNextCpuMoveIfNeeded() {
    if (gameState.gameOver) return;
    if (gameState.cpuVsCpu ||
        (gameState.cpuEnabled && gameState.currentPlayer === gameState.cpuPlayer)) {
        setTimeout(makeCpuMove, gameState.cpuMoveDelay);
    }
}

function makeCpuMove() {
    debugLog("CPU is thinking...");

    if (gameState.gameOver) return;

    if (gameState.cpuVsCpu) {
        // Both players are CPU — set cpuPlayer and difficulty for whoever's turn it is
        gameState.cpuPlayer = gameState.currentPlayer;
        const cfg = gameState.currentPlayer === 1 ? gameState.player1 : gameState.player2;
        if (cfg) gameState.cpuDifficulty = cfg.difficulty;
    } else if (!gameState.cpuEnabled || gameState.currentPlayer !== gameState.cpuPlayer) {
        debugLog("CPU move cancelled: " +
            (!gameState.cpuEnabled ? "CPU not enabled" : "Not CPU's turn"));
        return;
    }

    if (gameState.cpuDifficulty === 'expert') {
        makeExpertMove();
        return;
    }

    if (gameState.cpuDifficulty === 'hard') {
        // 'hard' difficult handles deciding to move and uncover based on strategic analysis
        moveStrategically();
        return;
    }

    // other difficulties are just random
    const canMove = hasValidMoves();

    if (canMove) {   
        // If CPU can move, decide whether to move or uncover based on strategy     
            const cpuMoveType = decideCpuMoveType();
            debugLog(`CPU chose to ${cpuMoveType} a piece (difficulty: ${gameState.cpuDifficulty})`);
            if (cpuMoveType === 'uncover') {
                uncoverRandomPiece();
            } else {
                moveRandomPiece();
            }
        
    } else {
        // If CPU has no valid moves, must uncover a piece
        debugLog("CPU has no valid moves, must uncover a piece");
        uncoverRandomPiece();
    }
}

function canUncover() {
    // Check if there are any covered pieces on the board
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece) {
                if (gameState.covered[row][col]) {
                    return true; // Found a covered piece
                }
            }
        }
    }
    return false; // No covered pieces found
}

function decideCpuMoveType() {
    // Count uncovered pieces for the CPU player
    let uncoveredPieces = 0;
    let coveredPieces = 0;

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece && piece.player === gameState.cpuPlayer) {
                if (!gameState.covered[row][col]) {
                    uncoveredPieces++;
                } else {
                    coveredPieces++;
                }
            }
        }
    }

    //If no pieces to uncover, return move
    if (coveredPieces === 0) {
        debugLog("No covered pieces available, CPU will move");
        return 'move';
    }

    // If no uncovered pieces, must uncover
    if (uncoveredPieces === 0) {
        debugLog("No uncovered pieces available, CPU must uncover");
        return 'uncover';
    }

    // anything other than hard difficulty, random choice
    return Math.random() < 0.5 ? 'uncover' : 'move';

}

function uncoverRandomPiece() {
    // Find all covered pieces (regardless of owner) - used for easy/medium difficulty
    // For hard difficulty, see uncoverStrategically()
    const coveredPieces = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece) {
                const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                if (gameState.covered[row][col]) {
                    coveredPieces.push({ row, col, element: cellElement });
                }
            }
        }
    }

    debugLog(`Found ${coveredPieces.length} covered pieces on the board`);

    if (coveredPieces.length === 0) {
        // No covered pieces, try moving instead
        debugLog("No covered pieces found, CPU has no valid moves");
        return;
    }

    // Choose a random covered piece
    const randomIndex = Math.floor(Math.random() * coveredPieces.length);
    const selectedPiece = coveredPieces[randomIndex];

    debugLog(`CPU will uncover piece at (${selectedPiece.row}, ${selectedPiece.col})`);

    // Directly uncover the piece without using handleCellClick to avoid potential issues
    const { row, col, element } = selectedPiece;
    if (element && gameState.board[row][col]) {
        debugLog("Directly uncovering CPU piece");
        const piece = gameState.board[row][col];

        // Uncover the piece
        gameState.covered[row][col] = false;
        element.classList.remove('covered');
        element.style.backgroundColor = PLAYER_COLORS[piece.player];
        element.textContent = piece.emoji;
        if (typeof gameLog !== 'undefined') gameLog.recordUncover(piece.player, row, col, piece);

        // Switch to next player
        debugLog("CPU's turn complete, switching turns");
        gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
        updateTurnIndicator();
        scheduleNextCpuMoveIfNeeded();
    } else {
        debugLog("Error: Failed to directly uncover piece - missing element or board data");
    }
}

function moveRandomPiece() {
    // Find all uncovered pieces for the CPU player
    const uncoveredPieces = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece && piece.player === gameState.cpuPlayer) {
                const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                if (!gameState.covered[row][col]) {
                    // Check if this piece has valid moves
                    const validMoves = getValidMoves(row, col);
                    if (validMoves.length > 0) {
                        uncoveredPieces.push({ row, col, element: cellElement, validMoves });
                    }
                }
            }
        }
    }

    debugLog(`Found ${uncoveredPieces.length} uncovered CPU pieces with valid moves`);

    if (uncoveredPieces.length === 0) {
        // No movable pieces, must uncover something
        debugLog("No movable pieces found, falling back to uncovering a piece");
        uncoverRandomPiece();
        return;
    }

    // Choose a random piece to move
    const randomPieceIndex = Math.floor(Math.random() * uncoveredPieces.length);
    const selectedPiece = uncoveredPieces[randomPieceIndex];

    // Choose a random valid move for the selected piece
    const randomMoveIndex = Math.floor(Math.random() * selectedPiece.validMoves.length);
    const selectedMove = selectedPiece.validMoves[randomMoveIndex];

    debugLog(`CPU will move from (${selectedPiece.row}, ${selectedPiece.col}) to (${selectedMove.row}, ${selectedMove.col})`);

    // Use the common execute function instead of duplicating the logic
    executeCpuMove(selectedPiece.row, selectedPiece.col, selectedMove.row, selectedMove.col);
}

function getValidMovesForPiece(row, col) {
    const piece = gameState.board[row][col];
    const validMoves = [];

    // Check all four directions
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
            // Cell with opponent's piece that is not covered
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

function hasValidMoves() {
    // Check if CPU has any uncovered pieces that can move
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece && piece.player === gameState.cpuPlayer) {
                if (!gameState.covered[row][col]) {
                    // Check if this piece has valid moves
                    const validMoves = getValidMoves(row, col);
                    if (validMoves.length > 0) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

// New function to check if a position is in danger (could be captured by opponent)
function isPositionInDanger(row, col, piece) {
    // Check all four directions for opponent pieces that could capture this piece
    const directions = [
        [-1, 0], // up
        [0, 1],  // right
        [1, 0],  // down
        [0, -1]  // left
    ];

    for (const [dRow, dCol] of directions) {
        const checkRow = row + dRow;
        const checkCol = col + dCol;

        // Check if position is within board
        if (checkRow >= 0 && checkRow < BOARD_SIZE && checkCol >= 0 && checkCol < BOARD_SIZE) {
            // Check if there's an opponent's piece
            const opponentPiece = gameState.board[checkRow][checkCol];
            if (opponentPiece && opponentPiece.player !== piece.player) {
                // Check if the opponent piece is uncovered
                if (!gameState.covered[checkRow][checkCol]) {
                    // Check if the opponent can capture based on power rules
                    if (canCapture(opponentPiece, piece)) {
                        return true; // Position is in danger
                    }
                }
            }
        }
    }
    return false; // Position is safe
}

// Check if a move would block an opponent from capturing a valuable piece
function wouldPreventCapture(row, col, piece) {
    // Look at all opponent pieces that could move to this position
    const playerToCheck = piece.player === 1 ? 2 : 1;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const opponentPiece = gameState.board[r][c];
            if (opponentPiece && opponentPiece.player === playerToCheck) {
                if (!gameState.covered[r][c]) {
                    // Check if this opponent piece could move to adjacent positions
                    const adjacentPositions = [
                        [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]
                    ];

                    // If this opponent piece is adjacent to our valuable pieces, and we're blocking it
                    for (const [adjRow, adjCol] of adjacentPositions) {
                        if (adjRow === row && adjCol === col) {
                            // We're moving to a position adjacent to an opponent's piece

                            // Check if there are any valuable CPU pieces nearby that need protection
                            const piecesToProtect = getAdjacentPieces(r, c, gameState.cpuPlayer);
                            if (piecesToProtect.some(p => p.piece.power >= 4 || p.piece.type === 'mouse')) {
                                return true; // This move protects a valuable piece
                            }
                        }
                    }
                }
            }
        }
    }

    return false;
}

// Get all pieces adjacent to a position
function getAdjacentPieces(row, col, playerFilter = null) {
    const adjacentPieces = [];
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const [dRow, dCol] of directions) {
        const checkRow = row + dRow;
        const checkCol = col + dCol;

        // Check if position is within board
        if (checkRow >= 0 && checkRow < BOARD_SIZE && checkCol >= 0 && checkCol < BOARD_SIZE) {
            const piece = gameState.board[checkRow][checkCol];
            if (piece && (playerFilter === null || piece.player === playerFilter)) {
                const cellElement = document.querySelector(`.cell[data-row="${checkRow}"][data-col="${checkCol}"]`);
                if (!gameState.covered[checkRow][checkCol]) {
                    adjacentPieces.push({
                        row: checkRow,
                        col: checkCol,
                        piece,
                        element: cellElement
                    });
                }
            }
        }
    }

    return adjacentPieces;
}

// Calculate bonus for controlling center positions
function getCenterControlBonus(row, col) {
    // Define center area
    const centerRows = [Math.floor(BOARD_SIZE / 3), Math.floor(BOARD_SIZE * 2 / 3)];
    const centerCols = [Math.floor(BOARD_SIZE / 3), Math.floor(BOARD_SIZE * 2 / 3)];

    // True center (middle of board)
    const centerRow = Math.floor(BOARD_SIZE / 2);
    const centerCol = Math.floor(BOARD_SIZE / 2);

    // Calculate distance from center
    const rowDist = Math.abs(row - centerRow);
    const colDist = Math.abs(col - centerCol);

    // Center positions get highest bonus
    if (row >= centerRows[0] && row <= centerRows[1] &&
        col >= centerCols[0] && col <= centerCols[1]) {
        return 1 + (2 - (rowDist + colDist)) * 0.2; // 1.0 - 1.4 bonus for center positions
    }

    return 0; // No bonus for edge positions
}

// New function for strategic move priorities
function moveStrategically() {
    // 1. Get all uncovered CPU pieces and their valid moves
    const piecesWithMoves = [];
    const piecesInDanger = [];
    const safeCaptures = [];
    const safeMoves = [];
    const unsafeCaptures = []; // For "go down fighting" moves

    debugLog("CPU is making a strategic move (hard difficulty)");

    // Analyze all pieces and classify their potential moves
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece && piece.player === gameState.cpuPlayer) {
                const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                if (!gameState.covered[row][col]) {
                    const validMoves = getValidMoves(row, col);

                    if (validMoves.length > 0) {
                        const pieceData = {
                            row,
                            col,
                            piece,
                            element: cellElement,
                            validMoves,
                            inDanger: isPositionInDanger(row, col, piece)
                        };

                        piecesWithMoves.push(pieceData);

                        if (pieceData.inDanger) {
                            piecesInDanger.push(pieceData);
                        }

                        // Analyze each valid move
                        validMoves.forEach(move => {
                            // Check if this move is a capture
                            const isCapture = gameState.board[move.row][move.col] !== null;

                            // Check if moving to this position would be safe
                            const wouldBeSafe = !isPositionInDanger(move.row, move.col, piece);
                            // Calculate strategic value of the move
                            let strategicValue = 0;

                            if (isCapture) {
                                const targetPiece = gameState.board[move.row][move.col];
                                // Base value is the power of the captured piece
                                strategicValue = targetPiece.power;

                                // Special case: capturing a dragon with a mouse is extremely valuable
                                if (piece.type === 'mouse' && targetPiece.type === 'dragon') {
                                    strategicValue += 15; // Huge bonus
                                }

                                // Special case: capturing a mouse with any piece is valuable (prevents mouse from taking dragon)
                                if (targetPiece.type === 'mouse') {
                                    strategicValue += 3; // Bonus for removing mice

                                    // Much higher bonus based on how close the mouse is to our dragon
                                    let dragonPos = null;
                                    for (let dr = 0; dr < BOARD_SIZE && !dragonPos; dr++) {
                                        for (let dc = 0; dc < BOARD_SIZE && !dragonPos; dc++) {
                                            const dp = gameState.board[dr][dc];
                                            if (dp && dp.type === 'dragon' && dp.player === gameState.cpuPlayer) {
                                                if (!gameState.covered[dr][dc]) dragonPos = { row: dr, col: dc };
                                            }
                                        }
                                    }
                                    if (dragonPos) {
                                        const mouseToDragonDist = Math.abs(move.row - dragonPos.row) + Math.abs(move.col - dragonPos.col);
                                        // The closer the mouse is to our dragon, the more urgently we want it dead
                                        strategicValue += Math.max(0, (6 - mouseToDragonDist)) * 2;
                                    }
                                }

                                // Capturing with a lower power piece is better (preserve powerful pieces)
                                if (piece.power < targetPiece.power) {
                                    strategicValue += (targetPiece.power - piece.power);
                                }

                                // Bonus for capturing higher-ranked pieces
                                if (targetPiece.power >= 5) {
                                    strategicValue += 3; // Eagle/Dragon are high-value targets
                                } else if (targetPiece.power >= 3) {
                                    strategicValue += 1; // Wolf/Bear are medium-value targets
                                }
                            }

                            // Check if this move would prevent an opponent capture on next turn
                            if (wouldPreventCapture(move.row, move.col, piece)) {
                                strategicValue += 3;
                            }

                            // Position-based strategy: prefer center positions over edges
                            const centerBonus = getCenterControlBonus(move.row, move.col);
                            strategicValue += centerBonus;

                            // Positional threat scoring: how many opponent pieces does this destination threaten?
                            // And how pinned (few escape routes) are they?
                            {
                                const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
                                for (const [dr, dc] of dirs) {
                                    const ar = move.row + dr;
                                    const ac = move.col + dc;
                                    if (ar < 0 || ar >= BOARD_SIZE || ac < 0 || ac >= BOARD_SIZE) continue;
                                    const adjPiece = gameState.board[ar][ac];
                                    if (!adjPiece || adjPiece.player === piece.player) continue;
                                    if (gameState.covered[ar][ac]) continue;
                                    if (canCapture(piece, adjPiece)) {
                                        strategicValue += 2.5; // Threatening an opponent piece is valuable
                                        // Extra bonus if opponent piece has few escape routes (it's pinned)
                                        const escapes = getValidMoves(ar, ac).filter(
                                            m => !(m.row === move.row && m.col === move.col)
                                        ).length;
                                        strategicValue += Math.max(0, 3 - escapes) * 1.5; // Fewer escapes = more pinned
                                    }
                                }
                            }

                            // Mouse-specific: bonus for moving toward an uncovered opponent dragon
                            if (piece.type === 'mouse' && !isCapture) {
                                const opPlayer = piece.player === 1 ? 2 : 1;
                                for (let dr = 0; dr < BOARD_SIZE; dr++) {
                                    for (let dc = 0; dc < BOARD_SIZE; dc++) {
                                        const tp = gameState.board[dr][dc];
                                        if (tp && tp.type === 'dragon' && tp.player === opPlayer) {
                                                if (!gameState.covered[dr][dc]) {
                                                const distDest = Math.abs(move.row - dr) + Math.abs(move.col - dc);
                                                const distFrom = Math.abs(row - dr) + Math.abs(col - dc);
                                                if (distDest < distFrom) {
                                                    strategicValue += (distFrom - distDest) * 4; // Chase the dragon
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Store the move with its context
                            const moveWithContext = {
                                from: { row, col },
                                to: move,
                                piece,
                                isCapture,
                                wouldBeSafe,
                                strategicValue,
                                targetPiece: isCapture ? gameState.board[move.row][move.col] : null
                            };

                            // Categorize the move
                            // Special case: mouse capturing dragon is ALWAYS forced into safe captures —
                            // the dragon cannot capture back, so "unsafe" neighbours are irrelevant for this trade
                            const isMouseDragonCapture = piece.type === 'mouse' && isCapture &&
                                gameState.board[move.row][move.col]?.type === 'dragon';

                            if (isCapture && (wouldBeSafe || isMouseDragonCapture)) {
                                safeCaptures.push(moveWithContext);
                            } else if (isCapture && !wouldBeSafe) {
                                unsafeCaptures.push(moveWithContext);
                            }

                            if (wouldBeSafe || isMouseDragonCapture) {
                                safeMoves.push(moveWithContext);
                            }
                        });
                    }
                }
            }
        }
    }

    // No pieces with valid moves, fall back to uncovering
    if (piecesWithMoves.length === 0) {
        debugLog("No pieces with valid moves found, falling back to uncovering");
        uncoverStrategically();
        return;
    }

    // Decision making in priority order
    let chosenMove = null;

    // ── Priority -3: ABSOLUTE OVERRIDE — mouse adjacent to opponent dragon ────
    // If any CPU mouse is directly adjacent to an uncovered enemy dragon, capture it NOW.
    // This must run before dragon-protection and all other priorities; the math shows
    // that any other consideration is worth less than removing the opponent's dragon.
    {
        const opPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
        for (const mover of piecesWithMoves) {
            if (mover.piece.type !== 'mouse') continue;
            for (const m of mover.validMoves) {
                const target = gameState.board[m.row][m.col];
                if (target && target.type === 'dragon' && target.player === opPlayer) {
                    if (!gameState.covered[m.row][m.col]) {
                        chosenMove = {
                            from: { row: mover.row, col: mover.col },
                            to: m,
                            piece: mover.piece,
                            isCapture: true,
                            wouldBeSafe: true,
                            strategicValue: 999,
                            targetPiece: target
                        };
                        debugLog(`Priority -3: CAPTURE DRAGON NOW with mouse at (${mover.row},${mover.col})`);
                        break;
                    }
                }
            }
            if (chosenMove) break;
        }
    }

    // ── Priority -2: Uncover own COVERED mouse that is adjacent to opponent's dragon ──
    // We know our own pieces, so if we have a covered mouse sitting next to an exposed
    // enemy dragon, reveal it now — next turn is an instant dragon kill.
    if (!chosenMove) {
        const opPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        outer:
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const piece = gameState.board[r][c];
                if (!piece || piece.player !== gameState.cpuPlayer || piece.type !== 'mouse') continue;
                const el = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                if (!gameState.covered[r][c]) continue; // must be covered
                // Check if this covered mouse is adjacent to an uncovered enemy dragon
                for (const [dr, dc] of dirs) {
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                    const neighbor = gameState.board[nr][nc];
                    if (!neighbor || neighbor.type !== 'dragon' || neighbor.player !== opPlayer) continue;
                    if (gameState.covered[nr][nc]) continue;
                    // Found covered mouse adjacent to exposed enemy dragon — uncover it
                    debugLog(`Priority -2: Uncovering own mouse at (${r},${c}) adjacent to enemy dragon — dragon kill next turn`);
                    gameState.covered[r][c] = false;
                    el.classList.remove('covered');
                    el.style.backgroundColor = PLAYER_COLORS[piece.player];
                    el.textContent = piece.emoji;
                    if (typeof gameLog !== 'undefined') gameLog.recordUncover(piece.player, r, c, piece);
                    checkGameOver();
                    if (!gameState.gameOver) {
                        gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
                        updateTurnIndicator();
                        scheduleNextCpuMoveIfNeeded();
                    }
                    return; // Done — no need to go through executeCpuMove
                }
            }
        }
    }

    // ── Pre-analysis: Identify board-wide threats ─────────────────────────────

    const opPlayer = gameState.cpuPlayer === 1 ? 2 : 1;

    // Find the strongest uncovered enemy piece
    let strongestEnemyPower = 0;
    let strongestEnemyPiece = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = gameState.board[r][c];
            if (!p || p.player !== opPlayer) continue;
            if (!gameState.covered[r][c] && p.power > strongestEnemyPower) {
                strongestEnemyPower = p.power;
                strongestEnemyPiece = { row: r, col: c, piece: p };
            }
        }
    }

    // Find the strongest uncovered CPU piece
    let strongestCpuPower = 0;
    for (const pw of piecesWithMoves) {
        if (pw.piece.power > strongestCpuPower) strongestCpuPower = pw.piece.power;
    }

    // Are we outclassed? (Enemy has a piece we can't currently counter)
    const isOutclassed = strongestEnemyPower >= 4 && strongestCpuPower < strongestEnemyPower;

    // ── Priority -1: Immediately activate a just-uncovered eagle/dragon ───────
    if (!chosenMove && gameState.cpuJustUncoveredHighValue) {
        const { row: hr, col: hc } = gameState.cpuJustUncoveredHighValue;
        const highValueMover = piecesWithMoves.find(p => p.row === hr && p.col === hc);
        if (highValueMover && highValueMover.validMoves.length > 0) {
            // Find the best move for it: prefer captures, then approach toward opponents
            const moves = highValueMover.validMoves.map(m => {
                let score = 0;
                const target = gameState.board[m.row][m.col];
                if (target && canCapture(highValueMover.piece, target)) score += 20 + target.power;
                // Proximity to nearest enemy
                let minDist = Infinity;
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        const ep = gameState.board[r][c];
                        if (!ep || ep.player !== opPlayer) continue;
                        if (!gameState.covered[r][c]) {
                            minDist = Math.min(minDist, Math.abs(m.row - r) + Math.abs(m.col - c));
                        }
                    }
                }
                score += (10 - Math.min(minDist, 10)) * 1.5;
                const safe = !isPositionInDanger(m.row, m.col, highValueMover.piece);
                if (!safe) score -= 20; // Strongly prefer safe destinations but don't discard entirely
                return { m, score, safe };
            });
            moves.sort((a, b) => b.score - a.score);
            // Only activate immediately if there's at least one safe move available
            const safeMoveExists = moves.some(mv => mv.safe);
            const best = safeMoveExists ? moves.find(mv => mv.safe) : null;
            if (best) {
                const isCapture = gameState.board[best.m.row][best.m.col] !== null;
                chosenMove = {
                    from: { row: hr, col: hc },
                    to: best.m,
                    piece: highValueMover.piece,
                    isCapture,
                    wouldBeSafe: true,
                    strategicValue: 99,
                    targetPiece: isCapture ? gameState.board[best.m.row][best.m.col] : null
                };
                debugLog(`Priority -1: Activating freshly uncovered ${highValueMover.piece.type} immediately`);
            } else {
                // No safe moves yet — clear the flag so we don't keep retrying unsafely
                gameState.cpuJustUncoveredHighValue = null;
                debugLog(`Priority -1: ${highValueMover.piece.type} has no safe moves yet — waiting`);
            }
        }
    }

    // Priority 0: Dragon protection from mice
    // If an enemy mouse is within 3 squares of our dragon, treat it as an emergency
    {
        const opPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
        let dragonPos = null;
        for (let r = 0; r < BOARD_SIZE && !dragonPos; r++) {
            for (let c = 0; c < BOARD_SIZE && !dragonPos; c++) {
                const p = gameState.board[r][c];
                if (p && p.type === 'dragon' && p.player === gameState.cpuPlayer) {
                    if (!gameState.covered[r][c]) dragonPos = { row: r, col: c };
                }
            }
        }

        if (dragonPos) {
            // Find all uncovered enemy mice and their distances to our dragon
            const threateningMice = [];
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const p = gameState.board[r][c];
                    if (p && p.type === 'mouse' && p.player === opPlayer) {
                        if (!gameState.covered[r][c]) {
                            const dist = Math.abs(r - dragonPos.row) + Math.abs(c - dragonPos.col);
                            if (dist <= 3) {
                                threateningMice.push({ row: r, col: c, piece: p, dist });
                                debugLog(`Dragon threat: enemy mouse at (${r},${c}) is ${dist} steps away`);
                            }
                        }
                    }
                }
            }

            if (threateningMice.length > 0) {
                threateningMice.sort((a, b) => a.dist - b.dist); // Closest mouse first
                const closestMouse = threateningMice[0];

                // Option A: Can any CPU piece capture the mouse this turn?
                const mouseKillers = [];
                for (const mover of piecesWithMoves) {
                    if (mover.piece.type === 'dragon') continue; // Dragon can't capture mouse
                    const canReach = mover.validMoves.some(m => m.row === closestMouse.row && m.col === closestMouse.col);
                    if (canReach && canCapture(mover.piece, closestMouse.piece)) {
                        const safe = !isPositionInDanger(closestMouse.row, closestMouse.col, mover.piece);
                        mouseKillers.push({
                            from: { row: mover.row, col: mover.col },
                            to: { row: closestMouse.row, col: closestMouse.col },
                            piece: mover.piece,
                            isCapture: true,
                            wouldBeSafe: safe,
                            strategicValue: 20 + (safe ? 5 : 0), // Extremely high priority
                            targetPiece: closestMouse.piece
                        });
                    }
                }

                if (mouseKillers.length > 0) {
                    mouseKillers.sort((a, b) => b.strategicValue - a.strategicValue);
                    chosenMove = mouseKillers[0];
                    debugLog(`Priority 0: Killing dragon-threatening mouse at (${closestMouse.row},${closestMouse.col}) with ${chosenMove.piece.type}`);
                }

                // Option B: If mouse is adjacent to dragon (dist=1) or 2 away, move dragon away
                if (!chosenMove && closestMouse.dist <= 2) {
                    const dragonMover = piecesWithMoves.find(p =>
                        p.piece.type === 'dragon' && p.row === dragonPos.row && p.col === dragonPos.col
                    );
                    if (dragonMover) {
                        // Find the safe move that maximises distance from all threatening mice
                        const fleeOptions = dragonMover.validMoves
                            .filter(m => !isPositionInDanger(m.row, m.col, dragonMover.piece))
                            .map(m => {
                                const minMouseDist = threateningMice.reduce((best, mouse) =>
                                    Math.min(best, Math.abs(m.row - mouse.row) + Math.abs(m.col - mouse.col)), Infinity);
                                return { move: m, minMouseDist };
                            })
                            .sort((a, b) => b.minMouseDist - a.minMouseDist);

                        if (fleeOptions.length > 0) {
                            const best = fleeOptions[0];
                            chosenMove = {
                                from: { row: dragonPos.row, col: dragonPos.col },
                                to: best.move,
                                piece: dragonMover.piece,
                                isCapture: gameState.board[best.move.row][best.move.col] !== null,
                                wouldBeSafe: true,
                                strategicValue: 18,
                                targetPiece: gameState.board[best.move.row][best.move.col]
                            };
                            debugLog(`Priority 0: Dragon fleeing from mouse (new dist: ${best.minMouseDist})`);
                        }
                    }
                }

                // Option C: Move an interceptor piece (cat/wolf/bear) to block the mouse's path to the dragon
                if (!chosenMove) {
                    // Find squares between the mouse and dragon that a CPU piece could move to
                    const interceptMoves = [];
                    for (const mover of piecesWithMoves) {
                        if (mover.piece.type === 'dragon' || mover.piece.type === 'mouse') continue;
                        for (const m of mover.validMoves) {
                            const distToDragon = Math.abs(m.row - dragonPos.row) + Math.abs(m.col - dragonPos.col);
                            const distToMouse = Math.abs(m.row - closestMouse.row) + Math.abs(m.col - closestMouse.col);
                            // A good intercept square is between mouse and dragon, or adjacent to the mouse's path
                            if (distToDragon <= closestMouse.dist && distToMouse <= closestMouse.dist) {
                                const safe = !isPositionInDanger(m.row, m.col, mover.piece);
                                interceptMoves.push({
                                    from: { row: mover.row, col: mover.col },
                                    to: m,
                                    piece: mover.piece,
                                    isCapture: gameState.board[m.row][m.col] !== null,
                                    wouldBeSafe: safe,
                                    strategicValue: 12 + (safe ? 3 : 0) - distToMouse,
                                    targetPiece: gameState.board[m.row][m.col]
                                });
                            }
                        }
                    }
                    if (interceptMoves.length > 0) {
                        interceptMoves.sort((a, b) => b.strategicValue - a.strategicValue);
                        chosenMove = interceptMoves[0];
                        debugLog(`Priority 0: Intercepting mouse path with ${chosenMove.piece.type}`);
                    }
                }
            }
        }
    }

    // Priority 0.5: Endgame coordination — when CPU has material advantage, actively hunt & corner opponent
    if (!chosenMove) {
        const opPlayer = gameState.cpuPlayer === 1 ? 2 : 1;

        // Gather uncovered pieces for both sides
        const cpuUncovered = [];
        const opUncovered = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = gameState.board[r][c];
                if (!p) continue;
                if (gameState.covered[r][c]) continue;
                if (p.player === gameState.cpuPlayer) cpuUncovered.push({ row: r, col: c, piece: p });
                else opUncovered.push({ row: r, col: c, piece: p });
            }
        }

        // Activate if we have more uncovered pieces than opponent, or same count but higher total power
        const cpuPower = cpuUncovered.reduce((s, p) => s + p.piece.power, 0);
        const opPower  = opUncovered.reduce((s, p) => s + p.piece.power, 0);
        const hasAdvantage = cpuUncovered.length > opUncovered.length ||
            (cpuUncovered.length === opUncovered.length && cpuPower > opPower + 1);

        if (hasAdvantage && opUncovered.length > 0 && opUncovered.length <= 3) {
            debugLog(`Endgame mode: CPU ${cpuUncovered.length} pieces (power ${cpuPower}) vs opponent ${opUncovered.length} pieces (power ${opPower})`);

            // Primary target: the opponent piece with the most escape routes (hardest to corner) — or highest power
            // Score each opponent piece by "cornering priority"
            const targets = opUncovered.map(op => {
                const escapeCount = getValidMoves(op.row, op.col).length;
                return { ...op, escapeCount };
            });
            // Prefer to corner the most mobile piece (most escapes = needs closing first)
            // but also weight by power (high-power pieces are more dangerous)
            targets.sort((a, b) => (b.escapeCount * 2 + b.piece.power) - (a.escapeCount * 2 + a.piece.power));
            const primaryTarget = targets[0];

            debugLog(`Endgame target: ${primaryTarget.piece.type}[${primaryTarget.piece.power}] at (${primaryTarget.row},${primaryTarget.col}) with ${primaryTarget.escapeCount} escapes`);

            // For each CPU mover, score moves that close in on the primary target
            const huntMoves = [];
            for (const mover of piecesWithMoves) {
                for (const m of mover.validMoves) {
                    const isCapture = gameState.board[m.row][m.col] !== null;
                    const isCaptureOfTarget = m.row === primaryTarget.row && m.col === primaryTarget.col;
                    const safe = !isPositionInDanger(m.row, m.col, mover.piece);
                    if (!safe && !isCaptureOfTarget) continue; // Skip unsafe non-capture moves in endgame

                    const distDest = Math.abs(m.row - primaryTarget.row) + Math.abs(m.col - primaryTarget.col);
                    const distFrom = Math.abs(mover.row - primaryTarget.row) + Math.abs(mover.col - primaryTarget.col);

                    // Simulate: if we move here, how many escapes does the target have?
                    // Quick approximation: count target's moves that would be blocked by our new position
                    const targetEscapes = getValidMoves(primaryTarget.row, primaryTarget.col);
                    const escapesBlocked = targetEscapes.filter(e =>
                        e.row === m.row && e.col === m.col  // We physically occupy that escape square
                    ).length;
                    const escapesRemaining = primaryTarget.escapeCount - escapesBlocked;

                    let huntScore = 0;
                    if (isCaptureOfTarget && canCapture(mover.piece, primaryTarget.piece)) {
                        huntScore = 50; // Capturing the target is the best move
                    } else if (distDest < distFrom) {
                        huntScore = (distFrom - distDest) * 3; // Reward closing distance
                    }
                    huntScore += escapesBlocked * 4;           // Reward cutting off escapes
                    huntScore += Math.max(0, 3 - escapesRemaining) * 3; // Reward pinning (few escapes left)

                    // Bonus for coordinated approach: if another CPU piece is ALREADY adjacent to target,
                    // our move closing in from a different direction is worth more
                    const alreadyPinning = cpuUncovered.filter(cp =>
                        cp.row !== mover.row || cp.col !== mover.col
                    ).some(cp => Math.abs(cp.row - primaryTarget.row) + Math.abs(cp.col - primaryTarget.col) === 1);
                    if (alreadyPinning && distDest <= 2) huntScore += 6;

                    if (huntScore > 0) {
                        huntMoves.push({
                            from: { row: mover.row, col: mover.col },
                            to: m,
                            piece: mover.piece,
                            isCapture,
                            wouldBeSafe: safe,
                            strategicValue: huntScore,
                            targetPiece: isCapture ? gameState.board[m.row][m.col] : null
                        });
                    }
                }
            }

            if (huntMoves.length > 0) {
                huntMoves.sort((a, b) => b.strategicValue - a.strategicValue);
                // Only override normal priorities if endgame hunt move is clearly better
                if (huntMoves[0].strategicValue >= 6) {
                    chosenMove = huntMoves[0];
                    debugLog(`Endgame hunt: ${chosenMove.piece.type} → (${chosenMove.to.row},${chosenMove.to.col}) score=${chosenMove.strategicValue}`);
                }
            }
        }
    }

    // Priority 0.8: When outclassed — flee pieces from strong enemy's range AND urgently uncover counter
    if (!chosenMove && isOutclassed && strongestEnemyPiece) {
        const threat = strongestEnemyPiece;
        debugLog(`Outclassed: enemy ${threat.piece.type}[${threat.piece.power}] vs our best [${strongestCpuPower}] — activating emergency response`);

        // Step 1: Any CPU piece with power < enemy's power that is within 2 squares should flee
        const fleeOptions = [];
        for (const mover of piecesWithMoves) {
            if (mover.piece.power >= threat.piece.power) continue; // Can fight back, no need to flee
            if (mover.piece.type === 'dragon') continue; // Dragon handles its own protection
            // CRITICAL: mice can capture dragons — never flee, always attack
            if (mover.piece.type === 'mouse' && threat.piece.type === 'dragon') continue;
            // More generally: if this piece CAN capture the threat, skip flee — let normal capture logic handle it
            if (canCapture(mover.piece, threat.piece)) continue;
            const distToThreat = Math.abs(mover.row - threat.row) + Math.abs(mover.col - threat.col);
            if (distToThreat > 2) continue; // Not in immediate danger zone

            // Find safe moves that increase distance from the threat
            for (const m of mover.validMoves) {
                const newDist = Math.abs(m.row - threat.row) + Math.abs(m.col - threat.col);
                if (newDist > distToThreat && !isPositionInDanger(m.row, m.col, mover.piece)) {
                    fleeOptions.push({
                        from: { row: mover.row, col: mover.col },
                        to: m,
                        piece: mover.piece,
                        isCapture: gameState.board[m.row][m.col] !== null,
                        wouldBeSafe: true,
                        strategicValue: (newDist - distToThreat) * 5 + mover.piece.power,
                        targetPiece: gameState.board[m.row][m.col]
                    });
                }
            }
        }
        if (fleeOptions.length > 0) {
            fleeOptions.sort((a, b) => b.strategicValue - a.strategicValue);
            chosenMove = fleeOptions[0];
            debugLog(`Priority 0.8: Fleeing ${chosenMove.piece.type} from enemy ${threat.piece.type}`);
        }

        // Step 2: If no flee needed, prefer uncovering to find a counter — but only if pieces exist
        if (!chosenMove) {
            if (canUncover()) {
                debugLog(`Priority 0.8: No pieces to flee — uncovering to find counter`);
                uncoverStrategically();
                return;
            }
            // No covered pieces available — fall through to normal priorities
            debugLog(`Priority 0.8: Outclassed but no covered pieces remain — playing normally`);
        }
    }

    // Priority 1: If a piece is in danger, try to move it to safety
    if (piecesInDanger.length > 0) {
        debugLog(`Found ${piecesInDanger.length} CPU pieces in danger`);

        // Sort pieces in danger by priority (higher power pieces first, but mice get priority over lower-power pieces)
        piecesInDanger.sort((a, b) => {
            // Special case: mice have higher priority than cats (power 2) because they can kill dragons
            if (a.piece.type === 'mouse' && b.piece.power <= 2) return -1;
            if (b.piece.type === 'mouse' && a.piece.power <= 2) return 1;

            // Otherwise, sort by power (highest first)
            return b.piece.power - a.piece.power;
        });

        debugLog(`Prioritized endangered pieces: ${piecesInDanger.map(p => p.piece.type).join(', ')}`);

        // For each piece in danger (by priority), check if it has a safe move
        for (const pieceData of piecesInDanger) {
            const safeMoveOptions = safeMoves.filter(m =>
                m.from.row === pieceData.row && m.from.col === pieceData.col);

            if (safeMoveOptions.length > 0) {
                // Sort safe moves by strategic value (prefer capturing high-value pieces)
                safeMoveOptions.sort((a, b) => b.strategicValue - a.strategicValue);

                // Choose the highest strategic value move
                chosenMove = safeMoveOptions[0];

                debugLog(`Moving ${pieceData.piece.type} out of danger ${chosenMove.isCapture ? `with capture of ${chosenMove.targetPiece.type}` : ''}`);
                break;
            }
        }
    }

    // Priority 1.5: Counter-attack — if one of our pieces is threatened, try to capture the threatening piece
    // with a DIFFERENT CPU piece (rather than just fleeing)
    if (!chosenMove && piecesInDanger.length > 0) {
        const counterAttacks = [];

        for (const threatened of piecesInDanger) {
            // Find which opponent pieces are threatening this piece
            const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dRow, dCol] of directions) {
                const threatRow = threatened.row + dRow;
                const threatCol = threatened.col + dCol;
                if (threatRow < 0 || threatRow >= BOARD_SIZE || threatCol < 0 || threatCol >= BOARD_SIZE) continue;

                const threatPiece = gameState.board[threatRow][threatCol];
                if (!threatPiece || threatPiece.player === gameState.cpuPlayer) continue;
                if (gameState.covered[threatRow][threatCol]) continue;
                if (!canCapture(threatPiece, threatened.piece)) continue;

                // Found the threatening piece — look for a CPU piece (not the threatened one) that can capture it
                for (const mover of piecesWithMoves) {
                    if (mover.row === threatened.row && mover.col === threatened.col) continue; // Skip the threatened piece itself
                    const canReach = mover.validMoves.some(m => m.row === threatRow && m.col === threatCol);
                    if (canReach && canCapture(mover.piece, threatPiece)) {
                        const wouldBeSafe = !isPositionInDanger(threatRow, threatCol, mover.piece);
                        counterAttacks.push({
                            from: { row: mover.row, col: mover.col },
                            to: { row: threatRow, col: threatCol },
                            piece: mover.piece,
                            isCapture: true,
                            wouldBeSafe,
                            strategicValue: threatPiece.power + (wouldBeSafe ? 5 : 0),
                            targetPiece: threatPiece
                        });
                    }
                }
            }
        }

        if (counterAttacks.length > 0) {
            counterAttacks.sort((a, b) => b.strategicValue - a.strategicValue);
            chosenMove = counterAttacks[0];
            debugLog(`CPU counter-attacking: ${chosenMove.piece.type} captures threatening ${chosenMove.targetPiece.type}`);
        }
    }

    // Priority 2: If no piece needs saving (or can't be saved), try to make a safe capture
    if (!chosenMove && safeCaptures.length > 0) {
        debugLog(`Found ${safeCaptures.length} possible safe captures`);

        // Sort by strategic value (factoring in special cases like mice/dragons)
        safeCaptures.sort((a, b) => b.strategicValue - a.strategicValue);

        chosenMove = safeCaptures[0]; // Take highest value safe capture
        debugLog(`CPU will capture ${chosenMove.targetPiece.type} safely with ${chosenMove.piece.type}`);
    }

    // Priority 3: Make any safe move — score by aggression (proximity to opponent pieces)
    if (!chosenMove && safeMoves.length > 0) {
        debugLog(`Found ${safeMoves.length} possible safe moves`);

        // Score each safe move by how close it gets to the nearest uncovered opponent piece
        const humanPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
        const opponentPositions = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = gameState.board[r][c];
                if (p && p.player === humanPlayer) {
                    if (!gameState.covered[r][c]) {
                        opponentPositions.push({ row: r, col: c, piece: p });
                    }
                }
            }
        }

        safeMoves.forEach(move => {
            let proximityScore = 0;
            if (opponentPositions.length > 0) {
                // Find the minimum Manhattan distance to any opponent piece from the destination
                const minDist = opponentPositions.reduce((best, op) => {
                    const d = Math.abs(move.to.row - op.row) + Math.abs(move.to.col - op.col);
                    return Math.min(best, d);
                }, Infinity);
                // Closer is better — invert distance (max board dist is ~10)
                proximityScore = (10 - minDist) * 0.5;

                // Bonus if destination puts us adjacent to a capturable opponent piece
                opponentPositions.forEach(op => {
                    const dist = Math.abs(move.to.row - op.row) + Math.abs(move.to.col - op.col);
                    if (dist === 1 && canCapture(move.piece, op.piece)) {
                        proximityScore += 3; // Will threaten capture on next turn
                    }
                });
            }

            // Mouse-specific proximity: if a dragon is visible, mice should actively chase it
            if (move.piece.type === 'mouse') {
                const humanPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        const p = gameState.board[r][c];
                        if (p && p.type === 'dragon' && p.player === humanPlayer) {
                            if (!gameState.covered[r][c]) {
                                const distDest = Math.abs(move.to.row - r) + Math.abs(move.to.col - c);
                                const distFrom = Math.abs(move.from.row - r) + Math.abs(move.from.col - c);
                                if (distDest < distFrom) proximityScore += (distFrom - distDest) * 5;
                            }
                        }
                    }
                }
            }

            // Anti-oscillation: penalise returning to any recently visited square (per piece type)
            const recentHistory = (gameState.cpuRecentSquares || {})[move.piece.type] || [];
            const recentVisits = recentHistory.filter(
                s => s.row === move.to.row && s.col === move.to.col
            ).length;
            if (recentVisits > 0) {
                proximityScore -= recentVisits * 7;
                debugLog(`Penalising oscillation for ${move.piece.type} (visited ${recentVisits}x recently)`);
            }

            move.proximityScore = proximityScore;
        });

        safeMoves.sort((a, b) => {
            const scoreA = a.strategicValue + a.proximityScore;
            const scoreB = b.strategicValue + b.proximityScore;
            if (Math.abs(scoreA - scoreB) > 0.5) return scoreB - scoreA;
            return Math.random() - 0.5; // Tie-break randomly
        });

        const bestMove = safeMoves[0];
        const bestMoveScore = bestMove.strategicValue + bestMove.proximityScore;

        // Count own covered pieces — if we have many and the best move is low-value, prefer uncovering
        let ownCoveredCount = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const p = gameState.board[r][c];
                if (p && p.player === gameState.cpuPlayer) {
                    if (gameState.covered[r][c]) ownCoveredCount++;
                }
            }
        }

        // Prefer uncovering over aimless repositioning:
        // If best safe move score is low (not a real threat) and we still have covered pieces, uncover instead
        const uncoverThreshold = opponentPositions.length === 0 ? 0 : 2; // low bar — any approach counts
        if (ownCoveredCount > 0 && bestMoveScore < uncoverThreshold) {
            debugLog(`Best safe move score (${bestMoveScore.toFixed(1)}) too low with ${ownCoveredCount} covered pieces — uncovering instead`);
            uncoverStrategically();
            return;
        }

        // Don't waste a turn moving a low-power piece when a high-power piece (eagle/dragon) is available
        // — unless the low-power move is genuinely good (capture or high score)
        const bestSafe = safeMoves[0];
        const cpuHasHighPowerMover = piecesWithMoves.some(p => p.piece.power >= 5);
        if (cpuHasHighPowerMover &&
            bestSafe.piece.power <= 2 &&
            !bestSafe.isCapture &&
            (bestSafe.strategicValue + bestSafe.proximityScore) < 6) {
            // Skip low-power loitering — prefer uncovering or high-power piece movement
            const highPowerMoves = safeMoves.filter(m => m.piece.power >= 5);
            if (highPowerMoves.length > 0) {
                chosenMove = highPowerMoves[0];
                debugLog(`Overriding low-power loiter: using ${chosenMove.piece.type} instead of ${bestSafe.piece.type}`);
            } else if (ownCoveredCount > 0) {
                uncoverStrategically();
                return;
            } else {
                chosenMove = bestSafe;
            }
        } else {
            // Take one of the top 3 moves (add some randomness to avoid being predictable)
            const index = Math.floor(Math.random() * Math.min(3, safeMoves.length));
            chosenMove = safeMoves[index];
        }
        debugLog(`CPU making aggressive safe move with ${chosenMove.piece.type} (score: ${((chosenMove.strategicValue || 0) + (chosenMove.proximityScore || 0)).toFixed(1)})`);
    }
    // Priority 4: If a piece can't be saved but can capture something, go down fighting (especially if it's a good trade)
    if (!chosenMove && piecesInDanger.length > 0 && unsafeCaptures.length > 0) {
        debugLog(`Looking for "go down fighting" opportunities among ${unsafeCaptures.length} unsafe captures`);

        // Filter to only captures by endangered pieces
        const lastStandCaptures = unsafeCaptures.filter(move => {
            return piecesInDanger.some(p => p.row === move.from.row && p.col === move.from.col);
        });

        if (lastStandCaptures.length > 0) {
            // Sort by multiple factors:
            // 1. Trade value (target power - our piece power)
            // 2. Special case for mouse capturing dragon (best possible trade)
            // 3. Strategic importance of the captured piece
            lastStandCaptures.sort((a, b) => {
                // Special case: Mouse capturing dragon is always the best last stand move
                if (a.piece.type === 'mouse' && a.targetPiece.type === 'dragon') return -1;
                if (b.piece.type === 'mouse' && b.targetPiece.type === 'dragon') return 1;

                // Trade value calculation
                const aTradeValue = a.targetPiece.power - a.piece.power;
                const bTradeValue = b.targetPiece.power - b.piece.power;

                if (aTradeValue !== bTradeValue) {
                    return bTradeValue - aTradeValue; // Higher trade value first
                }

                // If same trade value, prefer capturing higher power pieces
                return b.targetPiece.power - a.targetPiece.power;
            });

            // Calculate if the trade is worth making
            const bestTrade = lastStandCaptures[0];
            const tradeValue = bestTrade.targetPiece.power - bestTrade.piece.power;

            // Only make unfavorable trades if it's a high value target or we're desperate
            const isWorthSacrificing =
                tradeValue >= 0 || // Equal or favorable trade
                bestTrade.targetPiece.power >= 5 || // High value target (eagle, dragon)
                bestTrade.piece.type === 'mouse' && bestTrade.targetPiece.type === 'dragon' || // Special case
                piecesWithMoves.length <= 3; // Desperate situation, few pieces left

            if (isWorthSacrificing) {
                chosenMove = bestTrade;
                debugLog(`CPU making "go down fighting" move with ${chosenMove.piece.type} to capture ${chosenMove.targetPiece.type} (trade value: ${tradeValue})`);
            } else {
                debugLog(`Trade not worth making: ${bestTrade.piece.type} (${bestTrade.piece.power}) for ${bestTrade.targetPiece.type} (${bestTrade.targetPiece.power})`);
            }
        }
    }

    // Priority 4.5: Consider uncovering an own piece that would immediately threaten an opponent
    // This is worth doing even if we have valid moves, if the threat is high enough
    if (!chosenMove) {
        let bestUncoverScore = 0;
        let bestUncoverTarget = null;

        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                const piece = gameState.board[row][col];
                if (!piece || piece.player !== gameState.cpuPlayer) continue;
                const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                if (!gameState.covered[row][col]) continue;

                // Score uncovering this piece
                let score = 0;
                const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                for (const [dRow, dCol] of directions) {
                    const nRow = row + dRow;
                    const nCol = col + dCol;
                    if (nRow < 0 || nRow >= BOARD_SIZE || nCol < 0 || nCol >= BOARD_SIZE) continue;
                    const neighbor = gameState.board[nRow][nCol];
                    if (!neighbor || gameState.covered[nRow][nCol]) continue;
                    if (neighbor.player !== gameState.cpuPlayer && canCapture(piece, neighbor)) {
                        score += 8 + neighbor.power; // Will be able to capture on next move
                    }
                }

                if (score > bestUncoverScore) {
                    bestUncoverScore = score;
                    bestUncoverTarget = { row, col, element: cellElement, piece };
                }
            }
        }

        // Only uncover if the threat is significant (threshold: score > 9 means adjacent to at least a cat)
        if (bestUncoverTarget && bestUncoverScore >= 9) {
            debugLog(`CPU uncovering own piece to create capture threat (score: ${bestUncoverScore})`);
            const { row, col, element, piece } = bestUncoverTarget;
            gameState.covered[row][col] = false;
            element.classList.remove('covered');
            element.style.backgroundColor = PLAYER_COLORS[piece.player];
            element.textContent = piece.emoji;
            if (typeof gameLog !== 'undefined') gameLog.recordUncover(piece.player, row, col, piece);
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            updateTurnIndicator();
            scheduleNextCpuMoveIfNeeded();
            return;
        }
    }

    // Priority 5: All moves are unsafe — forced sacrifice. Pick the lowest-cost loss.
    // Never randomly sacrifice the eagle or dragon when a weaker piece could die instead.
    if (!chosenMove) {
        debugLog("No safe moves anywhere — choosing least-costly forced sacrifice");
        if (!canUncover()) {
            // Build all possible moves, sorted by ascending piece power so we lose the weakest first
            const forcedMoves = [];
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    const piece = gameState.board[row][col];
                    if (!piece || piece.player !== gameState.cpuPlayer) continue;
                    if (gameState.covered[row][col]) continue;
                    const moves = getValidMoves(row, col);
                    for (const m of moves) {
                        const isCapture = gameState.board[m.row][m.col] !== null;
                        const targetPow = isCapture ? gameState.board[m.row][m.col].power : 0;
                        forcedMoves.push({
                            from: { row, col }, to: m, piece,
                            isCapture, targetPow,
                            // Sort key: prefer high capture value, then prefer moving LOW-power pieces
                            sortKey: targetPow * 10 - piece.power
                        });
                    }
                }
            }
            if (forcedMoves.length > 0) {
                forcedMoves.sort((a, b) => b.sortKey - a.sortKey);
                chosenMove = forcedMoves[0];
                debugLog(`Priority 5 sacrifice: ${chosenMove.piece.type}[${chosenMove.piece.power}]` +
                    (chosenMove.isCapture ? ` capturing power ${chosenMove.targetPow}` : ' (no capture)'));
            } else {
                debugLog("Absolutely no moves — should not happen");
                return;
            }
        } else {
            uncoverStrategically();
            return;
        }
    }

    // Execute the chosen strategic move
    executeCpuMove(chosenMove.from.row, chosenMove.from.col, chosenMove.to.row, chosenMove.to.col);
}

// Execute a CPU move (extracted common functionality)
function executeCpuMove(fromRow, fromCol, toRow, toCol) {
    if (gameState.board[fromRow][fromCol]) {
        //debugLog(`CPU executing move from (${fromRow}, ${fromCol}) to (${toRow}, ${toCol})`);

        const fromPiece = gameState.board[fromRow][fromCol];
        const toPiece = gameState.board[toRow][toCol];

        // Update the board state
        gameState.board[toRow][toCol] = fromPiece;
        gameState.board[fromRow][fromCol] = null;

        // Update the visual representation
        const fromCell = document.querySelector(`.cell[data-row="${fromRow}"][data-col="${fromCol}"]`);
        const toCell = document.querySelector(`.cell[data-row="${toRow}"][data-col="${toCol}"]`);

        // Clear source cell
        if (fromCell) {
            fromCell.textContent = '';
            fromCell.style.backgroundColor = '#e0c9a6';  // Reset to board cell color
        }

        // Update target cell
        if (toCell) {
            toCell.textContent = fromPiece.emoji;
            toCell.style.backgroundColor = PLAYER_COLORS[fromPiece.player];
            gameState.covered[toRow][toCol] = false;
            toCell.classList.remove('covered', 'valid-move', 'valid-capture');
        }

        // Log capture if applicable
        if (toPiece) {
            debugLog(`CPU captured Player ${toPiece.player}'s ${toPiece.type} with a ${fromPiece.type}`);
        }

        // Record last move for oscillation detection
        gameState.cpuLastMoveFrom = { row: fromRow, col: fromCol };
        gameState.cpuLastMoveTo = { row: toRow, col: toCol };

        // Track recent squares per piece for multi-step oscillation detection
        // Key by piece type+player so each piece has its own history
        if (!gameState.cpuRecentSquares) gameState.cpuRecentSquares = {};
        const pieceKey = `${fromPiece.type}_${fromRow}_${fromCol}_${toRow}_${toCol}`;
        const histKey = `${fromPiece.type}`;
        gameState.cpuRecentSquares[histKey] = [
            { row: toRow, col: toCol },
            ...( gameState.cpuRecentSquares[histKey] || [] )
        ].slice(0, 6);

        // Clear high-value "just uncovered" flag once that piece makes its first move
        if (gameState.cpuJustUncoveredHighValue &&
            gameState.cpuJustUncoveredHighValue.row === fromRow &&
            gameState.cpuJustUncoveredHighValue.col === fromCol) {
            gameState.cpuJustUncoveredHighValue = null;
        }

        if (typeof gameLog !== 'undefined') {
            gameLog.recordMove(fromPiece.player, fromRow, fromCol, toRow, toCol, fromPiece, toPiece || null);
        }

        // Check if the game is over after the CPU's move
        if (!gameState.gameOver) {
            checkGameOver();
        }

        // Switch to next player (only if game is still going)
        if (!gameState.gameOver) {
            debugLog("CPU's turn complete, switching turns");
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            updateTurnIndicator();
            scheduleNextCpuMoveIfNeeded();
        }
    } else {
        debugLog("Error: Failed to move piece - missing board data");
    }
}

// Expert difficulty: use minimax with alpha-beta pruning
function makeExpertMove() {
    debugLog('CPU expert: running minimax...');

    let move;
    try {
        move = SkillMinimax.getBestMove();
    } catch (e) {
        debugLog('Minimax error: ' + e.message + ' — falling back to hard');
        moveStrategically();
        return;
    }

    if (!move) {
        debugLog('Minimax returned no move, falling back to hard');
        moveStrategically();
        return;
    }

    if (move.type === 'uncover') {
        const el = document.querySelector(`.cell[data-row="${move.r}"][data-col="${move.c}"]`);
        const piece = gameState.board[move.r][move.c];
        if (el && piece) {
            gameState.covered[move.r][move.c] = false;
            el.classList.remove('covered');
            el.style.backgroundColor = PLAYER_COLORS[piece.player];
            el.textContent = piece.emoji;
            if (typeof gameLog !== 'undefined') gameLog.recordUncover(piece.player, move.r, move.c, piece);
            // Flag high-value piece for immediate activation next turn
            if (piece.power >= 5) {
                gameState.cpuJustUncoveredHighValue = { row: move.r, col: move.c };
                debugLog(`Expert: flagged ${piece.type} for immediate activation`);
            }
            checkGameOver();
            if (!gameState.gameOver) {
                gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
                updateTurnIndicator();
                scheduleNextCpuMoveIfNeeded();
            }
        }
    } else {
        // move or capture
        executeCpuMove(move.fromR, move.fromC, move.toR, move.toC);
    }
}

// Function to strategically decide which piece to uncover
function uncoverStrategically() {
    // Find all covered pieces on the board, separated by ownership
    const ownCoveredPieces = [];
    const opponentCoveredPieces = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = gameState.board[row][col];
            if (piece) {
                const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                if (gameState.covered[row][col]) {
                    const entry = { row, col, element: cellElement, piece };
                    if (piece.player === gameState.cpuPlayer) {
                        ownCoveredPieces.push(entry);
                    } else {
                        opponentCoveredPieces.push(entry);
                    }
                }
            }
        }
    }

    debugLog(`Found ${ownCoveredPieces.length} own covered pieces and ${opponentCoveredPieces.length} opponent covered pieces`);

    if (ownCoveredPieces.length === 0 && opponentCoveredPieces.length === 0) {
        debugLog("No covered pieces found, CPU has no valid moves");
        return;
    }

    let selectedPiece = null;

    if (ownCoveredPieces.length > 0) {
        // Find own uncovered dragon position (if exposed) — used for dragon-safety penalty below
        const opPlayer = gameState.cpuPlayer === 1 ? 2 : 1;
        let ownDragonPos = null;
        for (let r = 0; r < BOARD_SIZE && !ownDragonPos; r++) {
            for (let c = 0; c < BOARD_SIZE && !ownDragonPos; c++) {
                const dp = gameState.board[r][c];
                if (dp && dp.type === 'dragon' && dp.player === gameState.cpuPlayer) {
                    if (!gameState.covered[r][c]) ownDragonPos = { row: r, col: c };
                }
            }
        }

        // Score each own covered piece by strategic value of uncovering it
        const scored = ownCoveredPieces.map(p => {
            let score = 0;
            const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

            for (const [dRow, dCol] of directions) {
                const checkRow = p.row + dRow;
                const checkCol = p.col + dCol;
                if (checkRow < 0 || checkRow >= BOARD_SIZE || checkCol < 0 || checkCol >= BOARD_SIZE) continue;

                const neighbor = gameState.board[checkRow][checkCol];
                const neighborUncovered = !gameState.covered[checkRow][checkCol];

                if (neighbor && neighbor.player !== gameState.cpuPlayer && neighborUncovered) {
                    // Adjacent to an opponent's uncovered piece — if our piece can capture it, big bonus
                    if (canCapture(p.piece, neighbor)) {
                        score += 10 + neighbor.power; // Immediate capture threat
                    }
                } else if (neighbor && neighbor.player === gameState.cpuPlayer && neighborUncovered) {
                    // Adjacent to own uncovered piece — good for building connected army
                    score += 2;
                }
            }

            // Dragon-safety: if our own dragon is exposed, penalise uncovering squares that are
            // orthogonally adjacent to it.  Revealing a piece there gives the opponent a free look
            // at whether that square is their mouse — we'd rather leave those squares for the
            // opponent to "waste" a turn on (your diagonal-open meta, encoded as a penalty).
            if (ownDragonPos) {
                const distToDragon = Math.abs(p.row - ownDragonPos.row) + Math.abs(p.col - ownDragonPos.col);
                if (distToDragon === 1) {
                    // Orthogonally adjacent to own dragon — opening this would tell opponent
                    // it ISN'T their mouse, potentially guiding their attack.
                    // Penalise unless it's specifically our own mouse (which we'd want to reveal
                    // to defend via Priority -2 logic, but that runs earlier).
                    score -= 8;
                    debugLog(`Dragon-safety penalty: (${p.row},${p.col}) is orthogonally adjacent to own dragon`);
                }
            }

            // Small center bonus
            const centerRow = Math.floor(BOARD_SIZE / 2);
            const centerCol = Math.floor(BOARD_SIZE / 2);
            const dist = Math.abs(p.row - centerRow) + Math.abs(p.col - centerCol);
            score += Math.max(0, 3 - dist) * 0.3;

            return { ...p, score };
        });

        scored.sort((a, b) => b.score - a.score);

        // Pick from the top candidates with slight randomness to avoid being predictable
        const topCount = Math.min(3, scored.length);
        const topCandidates = scored.slice(0, topCount);
        selectedPiece = topCandidates[Math.floor(Math.random() * topCandidates.length)];
        debugLog(`CPU will uncover own piece at (${selectedPiece.row}, ${selectedPiece.col}) with score ${selectedPiece.score.toFixed(1)}`);
    } else {
        // No own covered pieces left — pick a random opponent piece (last resort, rarely beneficial)
        selectedPiece = opponentCoveredPieces[Math.floor(Math.random() * opponentCoveredPieces.length)];
        debugLog(`CPU has no own covered pieces, uncovering opponent piece at (${selectedPiece.row}, ${selectedPiece.col})`);
    }

    // Directly uncover the selected piece
    const { row, col, element } = selectedPiece;
    if (element && gameState.board[row][col]) {
        debugLog("Directly uncovering piece");
        const piece = gameState.board[row][col];

        // Uncover the piece
        gameState.covered[row][col] = false;
        element.classList.remove('covered');
        element.style.backgroundColor = PLAYER_COLORS[piece.player];
        element.textContent = piece.emoji;
        if (typeof gameLog !== 'undefined') gameLog.recordUncover(piece.player, row, col, piece);

        // Flag high-value pieces so they move immediately on next turn
        if (piece.power >= 5) {
            gameState.cpuJustUncoveredHighValue = { row, col };
            debugLog(`Flagged high-value piece ${piece.type} at (${row},${col}) for immediate activation`);
        }

        // Switch to next player
        debugLog("CPU's turn complete, switching turns");
        gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
        updateTurnIndicator();
        scheduleNextCpuMoveIfNeeded();
    } else {
        debugLog("Error: Failed to directly uncover piece - missing element or board data");
    }
}

// Helper function to get the color of a cell without peeking at piece type
function getColorFromCell(cellElement) {
    // This uses only visually available information
    if (cellElement.classList.contains('covered')) {
        return 'covered';
    }
    return cellElement.style.backgroundColor;
}
