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
if (typeof io !== 'undefined') {
    serverMode.active = true;
    serverMode.socket = io();

    serverMode.socket.on('connect', () => {
        console.log('Connected to Skillego server');
        const joinSection = document.getElementById('join-game-section');
        if (joinSection) joinSection.style.display = '';
    });

    serverMode.socket.on('disconnect', () => {
        console.warn('Disconnected from server — will attempt to rejoin if game is active');
    });

    // ── Game lifecycle ────────────────────────────────────────────────────────
    serverMode.socket.on('game-created', ({ gameId, playerNumber, token }) => {
        serverMode.gameId       = gameId;
        serverMode.playerNumber = playerNumber;
        serverMode.token        = token;
        // game-started (or waiting-for-players) follows immediately from server
    });

    serverMode.socket.on('waiting-for-players', ({ gameId }) => {
        _showWaitOverlay(gameId);
    });

    serverMode.socket.on('game-joined', ({ gameId, playerNumber, token }) => {
        serverMode.gameId       = gameId;
        serverMode.playerNumber = playerNumber;
        serverMode.token        = token;
        // game-started follows immediately
    });

    serverMode.socket.on('game-started', ({ state }) => {
        _hideWaitOverlay();
        _showGameScreen(state);
    });

    serverMode.socket.on('game-rejoined', ({ state }) => {
        _hideWaitOverlay();
        _showGameScreen(state);
    });

    // ── In-game updates ───────────────────────────────────────────────────────
    serverMode.socket.on('state-update', ({ state }) => {
        applyServerState(state);
        if (state.gameOver) _handleServerGameOver(state.winner);
    });

    serverMode.socket.on('cpu-thinking', ({ player }) => {
        const el = document.getElementById('turn-indicator');
        if (el) el.textContent = `CPU P${player} is thinking…`;
    });

    serverMode.socket.on('move-rejected', ({ reason }) => {
        console.warn('Move rejected:', reason);
        // Re-sync from server in case local state drifted
        serverMode.socket.emit('rejoin-game', { gameId: serverMode.gameId, token: serverMode.token });
    });

    serverMode.socket.on('error', ({ message }) => {
        console.error('Server error:', message);
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

            if (!p) {
                el.textContent = '';
                el.style.backgroundColor = '#e0c9a6';
                el.classList.remove('covered', 'burning');
            } else if (covered) {
                el.textContent = '';
                el.style.backgroundColor = '#b8a080';
                el.classList.add('covered');
                el.classList.remove('burning');
            } else {
                el.textContent = p.emoji || _TYPE_EMOJI[p.type] || '';
                el.style.backgroundColor = PLAYER_COLORS[p.player] || '#e0c9a6';
                el.classList.remove('covered');
                p.burning ? el.classList.add('burning') : el.classList.remove('burning');
            }
        }
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function _showGameScreen(state) {
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

function _handleServerGameOver(winner) {
    gameState.gameOver = true;
    const isOurWin = winner === serverMode.playerNumber;
    let resultText, scoreText;

    if (!winner) {
        resultText = 'Draw!';
        scoreText  = 'Score: 0';
    } else if (serverMode.playerNumber === null) {
        resultText = `Player ${winner} Wins!`;
        scoreText  = `Score: ${calcPowerScore(winner)}`;
    } else if (isOurWin) {
        resultText = 'You Win!';
        scoreText  = `Score: ${calcPowerScore(winner)}`;
    } else {
        resultText = `Player ${winner} Wins!`;
        scoreText  = 'Score: 0';
    }

    showResult(resultText, scoreText);
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
    overlay.innerHTML = `
        <div style="background:#4a3728;padding:32px 40px;border-radius:12px;
                    text-align:center;max-width:320px;font-family:inherit;color:#f5e6d0">
            <h2 style="margin:0 0 10px">Waiting for players…</h2>
            <p style="margin:0 0 18px;color:#d2c1a3;font-size:14px">
                Share this game code with your friend:
            </p>
            <div style="font-size:2.8em;font-weight:bold;letter-spacing:8px;
                        color:#ffdd88;margin-bottom:18px">${gameId}</div>
            <p style="margin:0;font-size:12px;color:#9a8060">
                They enter it on the setup screen and click Join
            </p>
        </div>`;
    overlay.style.display = 'flex';
}

function _hideWaitOverlay() {
    const overlay = document.getElementById('wait-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ─── Join-game button wiring ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const joinBtn   = document.getElementById('join-game-btn');
    const joinInput = document.getElementById('join-code-input');
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
});
