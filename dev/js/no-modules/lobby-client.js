// lobby-client.js — pre-game lobby for hosted N-player network games.
// Hooks into the existing serverMode.socket. Designed to run after
// socket-client.js so serverMode is already declared.
//
// Wrapped in an IIFE so internal helpers don't leak to global scope —
// tournament-client.js historically defined a top-level `_renderLobby`,
// and we accidentally clobbered it when this file declared the same name.
// Lesson: in the no-modules build, every helper at top-level is a global,
// and any name overlap between client files is a silent bug. Until we
// actually consolidate these into a shared module, each client must
// quarantine its internals like this.
//
// Lifecycle:
//   1. User clicks "Host N-Player Game" → emit host-lobby → server creates
//      a Lobby and emits lobby-created. We render #lobby-page.
//   2. Joiners arrive via ?lobby=CODE link (or, in the future, an in-app
//      join input). Each emits join-lobby; server emits lobby-state to
//      everyone in the lobby room.
//   3. Host fills empty slots with CPUs, optionally renames, then clicks
//      Start. Server spawns a GameRoom and emits lobby-game-started to
//      every human member with their per-player handoff payload.
//   4. Each member's lobby-game-started handler flips serverMode into
//      game mode and routes through _showGameScreen — the existing 4P
//      mode-4p board rendering takes over.

(function () {
'use strict';

const lobbyMode = {
    active:      false,
    lobbyId:     null,
    playerId:    null,
    token:       null,
    displayName: null,
    isHost:      false,
    state:       null,  // last lobby-state payload
};

// Use the shared default-name generator so every multiplayer page picks
// names from the same convention. `MP` is defined by multiplayer-base.js.
function _lobbyDefaultName() {
    return MP.defaultDisplayName();
}

function _saveLobbySession() {
    sessionStorage.setItem('skillego_lobby_session', JSON.stringify({
        lobbyId:     lobbyMode.lobbyId,
        playerId:    lobbyMode.playerId,
        token:       lobbyMode.token,
        displayName: lobbyMode.displayName,
    }));
}
function _clearLobbySession() {
    sessionStorage.removeItem('skillego_lobby_session');
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function _lEl(id) { return document.getElementById(id); }

function _showLobbyPage() {
    const game = document.getElementById('game-container');
    const page = _lEl('lobby-page');
    if (game) game.style.display = 'none';
    if (page) page.style.display = '';
}

function _hideLobbyPage() {
    const page = _lEl('lobby-page');
    if (page) page.style.display = 'none';
    const game = document.getElementById('game-container');
    if (game) game.style.display = '';
}

function _renderLobby() {
    if (!lobbyMode.state) return;
    const s = lobbyMode.state;

    // Header — code + invite link
    const codeEl = _lEl('l-lobby-code');
    if (codeEl) codeEl.textContent = lobbyMode.lobbyId || s.id;

    // Config bar — players slot is an editable <select> for the host (so
    // they can flip between 2P and 4P before starting), readonly text for
    // joiners. Mirrors the tournament page's editable-config pattern.
    const cfgPlayers = _lEl('l-config-players');
    if (cfgPlayers) _renderPlayerCountCell(cfgPlayers, s);
    const cfgAbilities = _lEl('l-config-abilities');
    if (cfgAbilities) {
        cfgAbilities.textContent = (s.config.enabledAbilities || []).length
            ? s.config.enabledAbilities.join(', ')
            : '(none)';
    }

    // Status banner
    const status = _lEl('l-status');
    if (status) {
        const filled  = s.players.length;
        const need    = s.config.numPlayers - filled;
        const allHere = s.players.every(p => p.type === 'cpu' || p.status === 'lobby');
        if (need > 0) {
            status.textContent = `Waiting for ${need} more player${need === 1 ? '' : 's'}…`;
        } else if (!allHere) {
            status.textContent = 'Waiting for disconnected player to reconnect…';
        } else {
            status.textContent = lobbyMode.isHost
                ? 'Everyone\'s here. Click Start to begin.'
                : 'Everyone\'s here. Waiting for host to start.';
        }
    }

    // Player list
    const list = _lEl('l-player-list');
    if (list) {
        list.innerHTML = '';
        const seated = s.players.slice();
        // Render seated players. Reuses .t-player-chip styles from
        // tournament-client for visual consistency; .is-disconnected is
        // a lobby-only modifier defined in styles.css below the tournament
        // chip rules.
        for (const p of seated) {
            const chip = document.createElement('div');
            chip.className = 't-player-chip';
            if (p.playerId === lobbyMode.playerId) chip.classList.add('is-me');
            if (p.status === 'disconnected') chip.classList.add('is-disconnected');
            if (p.type === 'cpu') chip.classList.add('is-cpu');

            const name = document.createElement('span');
            name.className = 't-player-name';
            name.textContent = p.displayName;
            chip.appendChild(name);

            if (p.playerId === s.hostPlayerId) {
                const tag = document.createElement('span');
                tag.className = 't-player-tag';
                tag.textContent = 'host';
                chip.appendChild(tag);
            }
            if (p.type === 'cpu') {
                const tag = document.createElement('span');
                tag.className = 't-player-tag';
                tag.textContent = p.difficulty;
                chip.appendChild(tag);
            }
            if (p.status === 'disconnected') {
                const tag = document.createElement('span');
                tag.className = 't-status-pill status-forfeited';
                tag.textContent = 'disconnected';
                chip.appendChild(tag);
            }

            if (lobbyMode.isHost && p.type === 'cpu') {
                const btn = document.createElement('button');
                btn.className = 't-player-remove-btn';
                btn.textContent = 'Remove';
                btn.onclick = () => _emitRemoveCpu(p.playerId);
                chip.appendChild(btn);
            }
            list.appendChild(chip);
        }
        // Render empty slot placeholders
        for (let i = seated.length; i < s.config.numPlayers; i++) {
            const chip = document.createElement('div');
            chip.className = 't-player-chip is-empty';
            const name = document.createElement('span');
            name.className = 't-player-name';
            name.textContent = 'Empty slot';
            chip.appendChild(name);
            list.appendChild(chip);
        }
    }

    // Add-CPU row (host only, slots available)
    const addCpuRow = _lEl('l-add-cpu-row');
    if (addCpuRow) {
        const slotsLeft = s.config.numPlayers - s.players.length;
        addCpuRow.style.display = (lobbyMode.isHost && slotsLeft > 0) ? '' : 'none';
    }

    // Rename row — visible for the local player (any joiner, including host)
    const myPlayer = s.players.find(p => p.playerId === lobbyMode.playerId);
    const renameRow = _lEl('l-rename-row');
    if (renameRow) renameRow.style.display = myPlayer ? '' : 'none';
    const renameInput = _lEl('l-rename-input');
    if (renameInput && myPlayer && document.activeElement !== renameInput) {
        renameInput.value = myPlayer.displayName;
    }

    // Start button — host only, lobby full + everyone connected
    const startBtn = _lEl('l-start-btn');
    if (startBtn) {
        const filled  = s.players.length;
        const allHere = s.players.every(p => p.type === 'cpu' || p.status === 'lobby');
        const can     = lobbyMode.isHost && filled === s.config.numPlayers && allHere;
        startBtn.style.display = lobbyMode.isHost ? '' : 'none';
        startBtn.disabled = !can;
    }
}

// Render the player-count cell as a <select> for the host (so they can
// flip 2P↔4P before starting) or as plain text for joiners. Avoids
// rebuilding the <select> if it's already there so an open dropdown
// doesn't snap shut on every state broadcast.
function _renderPlayerCountCell(container, s) {
    const value = s.config.numPlayers;
    const seated = s.players.length;
    const editable = lobbyMode.isHost;

    if (!editable) {
        container.textContent = `${value}-player`;
        return;
    }

    let select = container.querySelector('select');
    if (!select) {
        container.innerHTML = `<select class="t-cfg-select">
            <option value="2">2-player</option>
            <option value="4">4-player</option>
        </select>`;
        select = container.querySelector('select');
        select.addEventListener('change', e => {
            const next = Number(e.target.value);
            if (next === lobbyMode.state.config.numPlayers) return;
            serverMode.socket.emit('update-lobby-config', {
                lobbyId:    lobbyMode.lobbyId,
                token:      lobbyMode.token,
                numPlayers: next,
            });
        });
    }
    if (Number(select.value) !== value) select.value = String(value);
    // Disable downgrade options that would drop below the seated count
    // so the host can't pick an invalid value just to be told no.
    Array.from(select.options).forEach(opt => {
        opt.disabled = Number(opt.value) < seated;
    });
}

// ─── Server actions ─────────────────────────────────────────────────────────
function _emitRemoveCpu(targetPlayerId) {
    if (!lobbyMode.active) return;
    serverMode.socket.emit('remove-lobby-cpu', {
        lobbyId:  lobbyMode.lobbyId,
        token:    lobbyMode.token,
        playerId: targetPlayerId,
    });
}

function _emitAddCpu(difficulty) {
    if (!lobbyMode.active) return;
    serverMode.socket.emit('add-lobby-cpu', {
        lobbyId:    lobbyMode.lobbyId,
        token:      lobbyMode.token,
        difficulty: difficulty || 'expert',
    });
}

function _emitRename(name) {
    if (!lobbyMode.active) return;
    serverMode.socket.emit('rename-in-lobby', {
        lobbyId: lobbyMode.lobbyId,
        token:   lobbyMode.token,
        name,
    });
}

function _emitStart() {
    if (!lobbyMode.active) return;
    serverMode.socket.emit('start-lobby-game', {
        lobbyId: lobbyMode.lobbyId,
        token:   lobbyMode.token,
    });
}

function leaveLobby() {
    if (!lobbyMode.active) {
        _hideLobbyPage();
        return;
    }
    serverMode.socket.emit('leave-lobby', {
        lobbyId: lobbyMode.lobbyId,
        token:   lobbyMode.token,
    });
    _resetLobbyMode();
    _clearLobbySession();
    _hideLobbyPage();
    if (typeof showSetupScreen === 'function') showSetupScreen();
}

function _resetLobbyMode() {
    lobbyMode.active      = false;
    lobbyMode.lobbyId     = null;
    lobbyMode.playerId    = null;
    lobbyMode.token       = null;
    lobbyMode.displayName = null;
    lobbyMode.isHost      = false;
    lobbyMode.state       = null;
}

function hostLobby({ numPlayers, enabledAbilities, displayName }) {
    if (!serverMode.socket || !serverMode.socket.connected) {
        alert('Not connected to game server.');
        return;
    }
    lobbyMode.displayName = displayName || _lobbyDefaultName();
    serverMode.socket.emit('host-lobby', {
        numPlayers,
        enabledAbilities,
        displayName: lobbyMode.displayName,
    });
}

function joinLobby(lobbyId, displayName) {
    if (!serverMode.socket || !serverMode.socket.connected) {
        // Wait for connect, then retry
        serverMode.socket.once('connect', () => joinLobby(lobbyId, displayName));
        return;
    }
    lobbyMode.displayName = displayName || _lobbyDefaultName();
    // Try with stored token first (reconnect path), then bare join.
    let storedToken = null;
    try {
        const raw = sessionStorage.getItem('skillego_lobby_session');
        if (raw) {
            const s = JSON.parse(raw);
            if (s && s.lobbyId === lobbyId) storedToken = s.token;
        }
    } catch (_) {}
    serverMode.socket.emit('join-lobby', {
        lobbyId,
        displayName: lobbyMode.displayName,
        token:       storedToken,
    });
}

// ─── Socket handlers ─────────────────────────────────────────────────────────
function _wireLobbySocket() {
    if (!serverMode.socket) return;
    const sock = serverMode.socket;

    sock.on('lobby-created', ({ lobbyId, playerId, token, state }) => {
        lobbyMode.active   = true;
        lobbyMode.lobbyId  = lobbyId;
        lobbyMode.playerId = playerId;
        lobbyMode.token    = token;
        lobbyMode.isHost   = (state.hostPlayerId === playerId);
        lobbyMode.state    = state;
        _saveLobbySession();
        _showLobbyPage();
        _renderLobby();
    });

    sock.on('lobby-joined', ({ lobbyId, playerId, token, state }) => {
        lobbyMode.active   = true;
        lobbyMode.lobbyId  = lobbyId;
        lobbyMode.playerId = playerId;
        lobbyMode.token    = token;
        lobbyMode.isHost   = (state.hostPlayerId === playerId);
        lobbyMode.state    = state;
        _saveLobbySession();
        _showLobbyPage();
        _renderLobby();
    });

    sock.on('lobby-state', ({ state }) => {
        if (!lobbyMode.active) return;
        lobbyMode.state  = state;
        lobbyMode.isHost = (state.hostPlayerId === lobbyMode.playerId);
        _renderLobby();
    });

    sock.on('lobby-game-started', ({ lobbyId, gameId, playerNumber, token, state }) => {
        // Capture display names BEFORE resetting lobbyMode so the in-game
        // turn indicator can show real names. The server-side buildGameSetup
        // assigns playerNumber by lobby-state insertion order (sorted by
        // playerId), so we mirror that here. Writes the unified
        // gameState.playerNames map that _computeTurnLabel reads.
        const names = {};
        if (lobbyMode.state && Array.isArray(lobbyMode.state.players)) {
            const seated = lobbyMode.state.players
                .slice()
                .sort((a, b) => Number(a.playerId) - Number(b.playerId));
            seated.forEach((p, idx) => { names[idx + 1] = p.displayName; });
        }
        gameState.playerNames = Object.keys(names).length ? names : null;

        // Hand off into game mode. Mirrors the create-game / join-game flow.
        _resetLobbyMode();
        _clearLobbySession();
        _hideLobbyPage();
        serverMode.active        = true;
        serverMode.gameId        = gameId;
        serverMode.token         = token;
        serverMode.playerNumber  = playerNumber;
        // Mirror socket-client's _saveSession (closure-private there) so a
        // refresh during the game can rejoin via the standard rejoin flow.
        try {
            sessionStorage.setItem('skillego_session', JSON.stringify({
                gameId, playerNumber, token,
            }));
        } catch (_) {}
        if (typeof _showGameScreen === 'function') {
            _showGameScreen(state);
        }
    });
}

// ─── DOM wiring ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    _wireLobbySocket();

    // Single host button on the setup screen — opens a lobby. The host
    // picks 2P or 4P from a dropdown inside the lobby itself, so there's
    // no longer a separate "Host 4-Player Game" entry point.
    const hostBtn = _lEl('host-game-btn');
    if (hostBtn) {
        hostBtn.addEventListener('click', () => {
            if (!serverMode.socket || !serverMode.socket.connected) {
                alert('Not connected to game server.');
                return;
            }
            const requested = Array.from(document.querySelectorAll('.ability-toggle:checked')).map(cb => cb.value);
            const { filtered, stripped } = (typeof stripUnsupportedAbilities === 'function')
                ? stripUnsupportedAbilities(new Set(requested))
                : { filtered: new Set(requested), stripped: [] };
            if (stripped.length) alert(`Server doesn't support: ${stripped.join(', ')} — disabled.`);
            hostLobby({
                numPlayers:       2,  // default — host can change in the lobby
                enabledAbilities: [...filtered],
                displayName:      _lobbyDefaultName(),
            });
        });
    }

    const leaveBtn = _lEl('l-leave-btn');
    if (leaveBtn) leaveBtn.addEventListener('click', leaveLobby);

    MP.setupCopyLinkButton(
        _lEl('l-copy-link-btn'),
        () => lobbyMode.lobbyId ? MP.inviteUrl('lobby', lobbyMode.lobbyId) : null,
        { idleLabel: '📋 Copy invite link' }
    );

    const startBtn = _lEl('l-start-btn');
    if (startBtn) startBtn.addEventListener('click', _emitStart);

    const addCpuBtn = _lEl('l-add-cpu-btn');
    if (addCpuBtn) {
        addCpuBtn.addEventListener('click', () => {
            const sel = _lEl('l-cpu-difficulty');
            _emitAddCpu(sel ? sel.value : 'expert');
        });
    }

    const renameBtn   = _lEl('l-rename-btn');
    const renameInput = _lEl('l-rename-input');
    if (renameBtn && renameInput) {
        const submit = () => {
            const v = renameInput.value.trim();
            if (v) _emitRename(v);
        };
        renameBtn.addEventListener('click', submit);
        renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }

    // Auto-join via ?lobby=CODE (parallel to ?join= and ?tournament=).
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('lobby');
    if (code) {
        const tryJoin = () => {
            joinLobby(code.trim().toUpperCase(), _lobbyDefaultName());
            window.history.replaceState({}, '', window.location.pathname);
        };
        if (serverMode.socket && serverMode.socket.connected) tryJoin();
        else if (serverMode.socket) serverMode.socket.once('connect', tryJoin);
    }
});

})();

