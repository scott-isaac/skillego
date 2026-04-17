// socket-client.js - Socket.io client wrapper
// Auto-detects server mode: if socket.io loads (served by Node), enables server mode.
// If it fails (GitHub Pages), the game runs standalone as before — no code change needed.

const serverMode = {
    active:       false,
    socket:       null,
    gameId:       null,
    playerNumber: null, // null = spectator (CPU vs CPU); 1..N = human player
    token:        null,
};

// Emoji lookup for re-hydrating pieces from server state (server strips emoji field)
const _TYPE_EMOJI = {
    mouse: '🐭', cat: '😸', dog: '🐶',
    wizard: '🧙‍♂️', robot: '🤖', dragon: '🐉',
};

// ─── Connection ───────────────────────────────────────────────────────────────
// Socket.io connects but server mode stays inactive until a multiplayer game
// is explicitly created/joined. Solo Human vs CPU runs standalone so the
// local game engine handles everything (game log recording, learning, etc.).
if (typeof io !== 'undefined') {
    // Connect to the game server. When served locally (localhost:3000),
    // io() auto-connects to the same origin. For GitHub Pages or other
    // static hosts, set SKILLEGO_SERVER in a script tag before this file
    // to point to the remote server (e.g. "https://crisiscontrol.app").
    const serverUrl = (typeof SKILLEGO_SERVER !== 'undefined') ? SKILLEGO_SERVER : undefined;
    serverMode.socket = io(serverUrl);

    serverMode.socket.on('connect', () => {
        console.log('Connected to Skillego server');
        const joinSection = document.getElementById('join-game-section');
        if (joinSection) joinSection.style.display = '';
    });

    serverMode.socket.on('disconnect', () => {
        console.warn('Disconnected from server — will attempt to rejoin if game is active');
    });

    // ── Session persistence (survive page refresh) ─────────────────────────
    function _saveSession() {
        sessionStorage.setItem('skillego_session', JSON.stringify({
            gameId: serverMode.gameId,
            playerNumber: serverMode.playerNumber,
            token: serverMode.token,
        }));
    }
    function _clearSession() {
        sessionStorage.removeItem('skillego_session');
    }

    // On connect, try to rejoin a saved session (page was refreshed).
    // Skip if there's a ?join= param in the URL — that takes priority.
    const hasJoinParam = new URLSearchParams(window.location.search).has('join');
    if (!hasJoinParam) {
        const saved = sessionStorage.getItem('skillego_session');
        if (saved) {
            try {
                const s = JSON.parse(saved);
                if (s.gameId && s.token) {
                    serverMode.gameId       = s.gameId;
                    serverMode.playerNumber = s.playerNumber;
                    serverMode.token        = s.token;
                    serverMode.active       = true;
                    serverMode.socket.emit('rejoin-game', { gameId: s.gameId, token: s.token });
                }
            } catch (e) { _clearSession(); }
        }
    }

    // ── Game lifecycle ────────────────────────────────────────────────────────
    serverMode.socket.on('game-created', ({ gameId, playerNumber, token }) => {
        serverMode.active       = true;
        serverMode.gameId       = gameId;
        serverMode.playerNumber = playerNumber;
        serverMode.token        = token;
        _saveSession();
    });

    serverMode.socket.on('waiting-for-players', ({ gameId }) => {
        // Make sure setup screen is hidden (in case of rejoin after refresh)
        document.getElementById('setup-screen').style.display = 'none';
        _showWaitOverlay(gameId);
    });

    serverMode.socket.on('game-joined', ({ gameId, playerNumber, token }) => {
        serverMode.active       = true;
        serverMode.gameId       = gameId;
        serverMode.playerNumber = playerNumber;
        serverMode.token        = token;
        _saveSession();
    });

    serverMode.socket.on('game-started', ({ state }) => {
        _hideWaitOverlay();
        _showGameScreen(state);
    });

    serverMode.socket.on('game-rejoined', ({ state }) => {
        _hideWaitOverlay();
        _hideDisconnectOverlay();
        if (state.gameOver) {
            // Game already ended — don't rejoin, go to setup
            serverMode.active = false;
            serverMode.gameId = null;
            serverMode.token = null;
            serverMode.playerNumber = null;
            _clearSession();
            showSetupScreen();
            return;
        }
        _showGameScreen(state);
    });

    // ── In-game updates ───────────────────────────────────────────────────────
    serverMode.socket.on('state-update', ({ state, lastMove }) => {
        if (lastMove) {
            _animateAndApply(state, lastMove);
        } else {
            applyServerState(state);
        }
        if (state.gameOver) _handleServerGameOver(state.winner);
    });

    serverMode.socket.on('cpu-thinking', ({ player }) => {
        const el = document.getElementById('turn-indicator');
        if (el) el.textContent = `CPU P${player} is thinking…`;
    });

    serverMode.socket.on('move-rejected', ({ reason }) => {
        console.warn('Move rejected:', reason);
        serverMode.socket.emit('rejoin-game', { gameId: serverMode.gameId, token: serverMode.token });
    });

    // ── Resign / Leave / Rematch ─────────────────────────────────────────────
    serverMode.socket.on('game-over', ({ state, winner, reason }) => {
        _clearSession();
        applyServerState(state);
        _handleServerGameOver(winner, reason);
    });

    serverMode.socket.on('opponent-left', ({ player }) => {
        _clearSession();
        // Host: disable Play Again
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn && serverMode.playerNumber === 1) {
            restartBtn.textContent = 'Opponent left';
            restartBtn.disabled = true;
            restartBtn.style.opacity = '0.5';
        }
        // Joiner: update status text
        const statusEl = document.getElementById('network-status');
        if (statusEl && serverMode.playerNumber !== 1) {
            statusEl.textContent = 'Host left';
        }
    });

    serverMode.socket.on('opponent-disconnected', ({ player }) => {
        if (gameState.gameOver) return;
        _showDisconnectOverlay(player);
    });

    // When opponent reconnects, server re-sends state via rejoin flow.
    // Listen for state-update while overlay is showing to dismiss it.
    serverMode.socket.on('opponent-reconnected', ({ player }) => {
        _hideDisconnectOverlay();
    });

    serverMode.socket.on('rematch-started', ({ gameId, state }) => {
        serverMode.gameId = gameId;
        _showGameScreen(state);
    });

    serverMode.socket.on('error', ({ message }) => {
        console.error('Server error:', message);
        // If we were trying to rejoin or join a game that no longer exists,
        // clean up and go back to setup screen.
        if (message === 'Game not found' || message === 'Game not found or expired' || message === 'Invalid token') {
            serverMode.active = false;
            serverMode.gameId = null;
            serverMode.token = null;
            serverMode.playerNumber = null;
            _clearSession();
            _hideWaitOverlay();
            _hideDisconnectOverlay();
            showSetupScreen();
        }
    });

    // ── Rejoin on reconnect if game is active ─────────────────────────────────
    serverMode.socket.on('connect', () => {
        if (serverMode.gameId && serverMode.token) {
            serverMode.socket.emit('rejoin-game', { gameId: serverMode.gameId, token: serverMode.token });
        }
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────
serverMode.createGame = function({ numPlayers, playerConfigs, enabledAbilities }) {
    serverMode.socket.emit('create-game', { numPlayers, playerConfigs, enabledAbilities });
};

serverMode.joinGame = function(gameId) {
    serverMode.socket.emit('join-game', { gameId: gameId.trim().toUpperCase() });
};

// Send a move to the server and immediately clear the selection UI.
serverMode.sendMove = function(move) {
    serverMode.socket.emit('make-move', {
        gameId: serverMode.gameId,
        token:  serverMode.token,
        move,
    });
    document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    clearValidMoves();
    clearSkillTray();
    gameState.selectedCell = null;
};

// ─── State application ────────────────────────────────────────────────────────
// Overwrites local gameState with the authoritative server state and re-renders.
function applyServerState(state) {
    gameState.board = state.board.map(row => row.map(cell => {
        if (!cell) return null;
        if (cell.player === 0) return cell; // covered/unknown — no emoji needed
        return { ...cell, emoji: _TYPE_EMOJI[cell.type] || '?' };
    }));
    gameState.covered           = state.covered.map(row => [...row]);
    gameState.currentPlayer     = state.currentPlayer;
    gameState.numPlayers        = state.numPlayers;
    gameState.eliminatedPlayers = new Set(state.eliminatedPlayers || []);
    gameState.gameOver          = state.gameOver || false;
    if (state.enabledAbilities) {
        gameState.enabledAbilities = new Set(state.enabledAbilities);
    }

    renderBoardFromState();
    updateTurnIndicator();
}

function renderBoardFromState() {
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const el = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
            if (!el) continue;
            const p       = gameState.board[r][c];
            const covered = gameState.covered[r][c];
            el.classList.remove('valid-move', 'valid-capture', 'selected', 'push-destination-preview');
            renderCell(el, p, covered);
        }
    }
}

// ─── Move Animation ──────────────────────────────────────────────────────────
// Execute the opponent's move using the SAME board functions as local play
// (movePiece, hopPiece, etc.) so animations are identical.
// Then reconcile with the authoritative server state.
function _animateAndApply(newState, move) {
    const RECONCILE_MS = gameState.animationsEnabled ? 300 : 0;

    try {
        switch (move.type) {
            case 'move':
            case 'capture':
                movePiece(move.fromR, move.fromC, move.toR, move.toC);
                break;
            case 'uncover': {
                // Apply server state for uncover — it reveals the piece identity
                const piece = newState.board[move.r][move.c];
                if (piece) {
                    gameState.board[move.r][move.c] = { ...piece, emoji: _TYPE_EMOJI[piece.type] || '?' };
                    gameState.covered[move.r][move.c] = false;
                }
                const el = document.querySelector(`.cell[data-row="${move.r}"][data-col="${move.c}"]`);
                if (el) renderCell(el, gameState.board[move.r][move.c], false);
                break;
            }
            case 'hop':
                // Use the board-level hop animation directly
                if (typeof executeHop === 'function') {
                    // executeHop checks serverMode and sends to server — bypass that
                    const fromEl = document.querySelector(`.cell[data-row="${move.fromR}"][data-col="${move.fromC}"]`);
                    const toEl   = document.querySelector(`.cell[data-row="${move.toR}"][data-col="${move.toC}"]`);
                    const piece  = gameState.board[move.fromR]?.[move.fromC];
                    if (piece && fromEl && toEl) {
                        gameState.board[move.toR][move.toC] = piece;
                        gameState.board[move.fromR][move.fromC] = null;
                        gameState.covered[move.toR][move.toC] = false;
                        hopPiece(fromEl, toEl, piece, () => renderCell(toEl, piece, false));
                        renderCell(fromEl, null, false);
                    }
                }
                break;
            case 'push': {
                const fromEl = document.querySelector(`.cell[data-row="${move.enemyR}"][data-col="${move.enemyC}"]`);
                const toEl   = document.querySelector(`.cell[data-row="${move.destR}"][data-col="${move.destC}"]`);
                const piece  = gameState.board[move.enemyR]?.[move.enemyC];
                if (piece && fromEl && toEl) {
                    gameState.board[move.destR][move.destC] = piece;
                    gameState.board[move.enemyR][move.enemyC] = null;
                    gameState.covered[move.destR][move.destC] = false;
                    slidePiece(fromEl, toEl, piece, () => renderCell(toEl, piece, false));
                    renderCell(fromEl, null, false);
                }
                break;
            }
            case 'snipe': {
                const fromEl = document.querySelector(`.cell[data-row="${move.robotR}"][data-col="${move.robotC}"]`);
                const toEl   = document.querySelector(`.cell[data-row="${move.targetR}"][data-col="${move.targetC}"]`);
                const piece  = gameState.board[move.robotR]?.[move.robotC];
                if (piece && fromEl && toEl) {
                    gameState.board[move.targetR][move.targetC] = piece;
                    gameState.board[move.robotR][move.robotC] = null;
                    gameState.covered[move.targetR][move.targetC] = false;
                    slidePiece(fromEl, toEl, piece, () => renderCell(toEl, piece, false));
                    renderCell(fromEl, null, false);
                }
                break;
            }
            default:
                // engulf, transform, pyro — just apply state directly
                applyServerState(newState);
                return;
        }
    } catch (e) {
        console.warn('Animation failed, applying state directly:', e);
        applyServerState(newState);
        return;
    }

    // Reconcile with authoritative server state after animation finishes.
    // This corrects any drift (e.g., burning power changes, eliminated players).
    setTimeout(() => {
        applyServerState(newState);
    }, RECONCILE_MS);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function _showGameScreen(state) {
    // Ensure the board DOM exists before rendering server state
    const boardCfg = BOARD_CONFIG[state.numPlayers] || BOARD_CONFIG[2];
    BOARD_ROWS = boardCfg.rows;
    BOARD_COLS = boardCfg.cols;
    initializeBoard();

    applyServerState(state);

    document.getElementById('setup-screen').style.display   = 'none';
    document.getElementById('winner-message').style.display = 'none';
    document.getElementById('resign-button').style.display  = '';
    document.getElementById('help-button').style.display    = '';
    document.getElementById('turn-indicator').style.display = '';

    const resignBtn = document.getElementById('resign-button');
    if (resignBtn) {
        const isSpectator = serverMode.playerNumber === null;
        resignBtn.textContent = isSpectator ? 'Stop' : 'Resign';
    }
}

function _handleServerGameOver(winner, reason) {
    gameState.gameOver = true;
    const isOurWin = winner === serverMode.playerNumber;
    let resultText, scoreText;

    if (!winner) {
        resultText = 'Draw!';
        scoreText  = '';
    } else if (serverMode.playerNumber === null) {
        resultText = `Player ${winner} Wins!`;
        scoreText  = reason || '';
    } else if (isOurWin) {
        resultText = 'You Win!';
        scoreText  = reason || '';
    } else {
        resultText = 'You Lose!';
        scoreText  = reason || '';
    }

    if (typeof gameLog !== 'undefined') gameLog.saveToServer();
    showResult(resultText, scoreText);

    // Customize buttons for network play
    const restartBtn = document.getElementById('restart-btn');
    const newGameBtn = document.getElementById('new-game-btn');

    if (restartBtn) {
        if (serverMode.playerNumber === 1) {
            // Host can request rematch
            restartBtn.textContent = 'Play Again';
            restartBtn.disabled = false;
            restartBtn.style.opacity = '';
            restartBtn.onclick = () => {
                serverMode.socket.emit('rematch', {
                    gameId: serverMode.gameId,
                    token: serverMode.token,
                });
            };
        } else {
            restartBtn.style.display = 'none';
        }

        // Joiner sees status text above the buttons
        const statusEl = document.getElementById('network-status');
        if (statusEl && serverMode.playerNumber !== 1) {
            statusEl.textContent = 'Waiting for host to restart...';
            statusEl.style.display = '';
        }
    }

    if (newGameBtn) {
        newGameBtn.textContent = 'Leave';
        newGameBtn.onclick = () => {
            serverMode.socket.emit('leave-game', {
                gameId: serverMode.gameId,
                token: serverMode.token,
            });
            serverMode.active = false;
            serverMode.gameId = null;
            serverMode.token = null;
            serverMode.playerNumber = null;
            _clearSession();
            const statusEl = document.getElementById('network-status');
            if (statusEl) statusEl.style.display = 'none';
            showSetupScreen();
            // Reset buttons for next game
            restartBtn.style.display = '';
            restartBtn.disabled = false;
            restartBtn.style.opacity = '';
            restartBtn.onclick = null;
            newGameBtn.onclick = null;
        };
    }
}

function _showWaitOverlay(gameId) {
    let overlay = document.getElementById('wait-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'wait-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0',
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            zIndex: '999',
        });
        document.body.appendChild(overlay);
    }
    const joinUrl = `${window.location.origin}${window.location.pathname}?join=${gameId}`;
    overlay.innerHTML = `
        <div style="background:#4a3728;padding:32px 40px;border-radius:12px;
                    text-align:center;max-width:380px;font-family:inherit;color:#f5e6d0">
            <h2 style="margin:0 0 14px">Waiting for opponent</h2>
            <p style="margin:0 0 12px;color:#d2c1a3;font-size:14px">
                Send this link to your friend:
            </p>
            <div id="join-link-box" style="background:#2a1e10;border:2px solid #6e583b;
                        border-radius:6px;padding:10px 14px;margin-bottom:14px;
                        cursor:pointer;word-break:break-all;
                        font-size:14px;color:#ffdd88">${joinUrl}</div>
            <button id="copy-link-btn" class="btn-primary" style="margin-bottom:8px">Copy Link</button>
            <p style="margin:0 0 16px;font-size:12px;color:#9a8060">
                Or share the code: <strong style="letter-spacing:4px;color:#ffdd88">${gameId}</strong>
            </p>
            <button id="cancel-host-btn" class="btn-secondary">Cancel</button>
        </div>`;
    overlay.style.display = 'flex';

    document.getElementById('copy-link-btn').addEventListener('click', () => {
        // navigator.clipboard requires HTTPS; use execCommand fallback for HTTP
        let copied = false;
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(joinUrl).then(() => {}).catch(() => {});
            copied = true;
        }
        if (!copied) {
            const ta = document.createElement('textarea');
            ta.value = joinUrl;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        document.getElementById('copy-link-btn').textContent = 'Copied!';
        setTimeout(() => {
            const btn = document.getElementById('copy-link-btn');
            if (btn) btn.textContent = 'Copy Link';
        }, 2000);
    });

    document.getElementById('cancel-host-btn').addEventListener('click', () => {
        serverMode.socket.emit('leave-game', {
            gameId: serverMode.gameId,
            token: serverMode.token,
        });
        serverMode.active = false;
        serverMode.gameId = null;
        serverMode.token = null;
        serverMode.playerNumber = null;
        _clearSession();
        _hideWaitOverlay();
        showSetupScreen();
    });
}

function _hideWaitOverlay() {
    const overlay = document.getElementById('wait-overlay');
    if (overlay) overlay.style.display = 'none';
}

function _showDisconnectOverlay(player) {
    let overlay = document.getElementById('disconnect-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'disconnect-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0',
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            zIndex: '999',
        });
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div style="background:#4a3728;padding:32px 40px;border-radius:12px;
                    text-align:center;max-width:320px;font-family:inherit;color:#f5e6d0">
            <h2 style="margin:0 0 10px">Opponent disconnected</h2>
            <p style="margin:0 0 18px;color:#d2c1a3;font-size:14px">
                Waiting for them to reconnect...
            </p>
            <button id="disconnect-leave-btn">Leave Game</button>
        </div>`;
    overlay.style.display = 'flex';

    document.getElementById('disconnect-leave-btn').addEventListener('click', () => {
        _hideDisconnectOverlay();
        serverMode.socket.emit('leave-game', {
            gameId: serverMode.gameId,
            token: serverMode.token,
        });
        serverMode.active = false;
        serverMode.gameId = null;
        serverMode.token = null;
        serverMode.playerNumber = null;
        _clearSession();
        const statusEl = document.getElementById('network-status');
        if (statusEl) statusEl.remove();
        showSetupScreen();
    });
}

function _hideDisconnectOverlay() {
    const overlay = document.getElementById('disconnect-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ─── Host / Join button wiring ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const hostBtn   = document.getElementById('host-game-btn');
    const joinBtn   = document.getElementById('join-game-btn');
    const joinInput = document.getElementById('join-code-input');

    if (hostBtn) {
        hostBtn.addEventListener('click', () => {
            // Host a network game: P1 = local human, P2 = remote human.
            gameState.player1 = { type: 'human' };
            gameState.player2 = { type: 'human' };
            gameState.numPlayers = 2;
            gameState.cpuEnabled = false;

            // Read abilities from the setup screen checkboxes (same as startGame)
            gameState.enabledAbilities = new Set(
                Array.from(document.querySelectorAll('.ability-toggle:checked')).map(cb => cb.value)
            );

            serverMode.createGame({
                numPlayers: 2,
                playerConfigs: {
                    1: { type: 'human' },
                    2: { type: 'human' },
                },
                enabledAbilities: [...gameState.enabledAbilities],
            });
        });
    }

    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            const code = joinInput?.value?.trim();
            if (code) serverMode.joinGame(code);
        });
    }
    if (joinInput) {
        joinInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const code = joinInput.value.trim();
                if (code) serverMode.joinGame(code);
            }
        });
    }

    // Auto-join if URL has ?join=XXXX
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join');
    if (joinCode && serverMode.socket) {
        // Wait for socket to connect, then join
        const tryJoin = () => {
            gameState.player1 = { type: 'human' };
            gameState.player2 = { type: 'human' };
            gameState.numPlayers = 2;
            gameState.cpuEnabled = false;
            serverMode.joinGame(joinCode.trim().toUpperCase());
            // Clean the URL so refresh doesn't re-join
            window.history.replaceState({}, '', window.location.pathname);
        };
        if (serverMode.socket.connected) {
            tryJoin();
        } else {
            serverMode.socket.once('connect', tryJoin);
        }
    }
});
