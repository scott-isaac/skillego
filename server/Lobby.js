'use strict';

// Lobby — pre-game waiting room for a hosted N-player network game.
// One Lobby maps to one upcoming GameRoom. When the host clicks Start, the
// server spawns a GameRoom from the lobby's player list and disposes the
// lobby. Lobbies have no bracket, no rounds, no scoring — they're just a
// way to assemble players and configure abilities before the game begins.
//
// Status:
//   'lobby'   — accepting joiners, host hasn't pressed start
//   'started' — GameRoom spawned; lobby is on its way to disposal
//
// Per-player status:
//   'lobby'        — connected and seated
//   'disconnected' — socket dropped; will be removed if not reclaimed within
//                    the grace window (caller-managed timer)
class Lobby {
    constructor(id, config) {
        this.id     = id;
        this.status = 'lobby';
        this.config = {
            numPlayers:       config.numPlayers || 4,
            enabledAbilities: (config.enabledAbilities || []).slice(),
        };
        this.players      = new Map();   // playerId → record (see addPlayer)
        this.hostPlayerId = null;
        this._nextPlayerId = 1;
    }

    // Add a human or CPU. Humans get socketId+token; CPUs use null for both.
    // opts: { type: 'human' | 'cpu', difficulty?: 'easy'|'medium'|'hard'|'expert', displayName? }
    addPlayer(socketId, token, displayName, opts = {}) {
        if (this.isFull()) throw new Error('Lobby is full');
        const playerId = String(this._nextPlayerId++);
        this.players.set(playerId, {
            socketId,
            token,
            displayName,
            type:       opts.type || 'human',
            difficulty: opts.type === 'cpu' ? (opts.difficulty || 'expert') : null,
            status:     'lobby',
            // Set when socket disconnects so the caller's grace timer can
            // tell whether a reconnect within the window is the same player.
            _disconnectedAt: null,
        });
        return playerId;
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        if (this.hostPlayerId === playerId) {
            // Pick a new host: lowest player ID that's a connected human.
            const candidates = [...this.players.entries()]
                .filter(([, p]) => p.type === 'human' && p.status === 'lobby')
                .map(([pid]) => pid)
                .sort((a, b) => Number(a) - Number(b));
            this.hostPlayerId = candidates[0] || null;
        }
    }

    updateName(playerId, name) {
        const p = this.players.get(playerId);
        if (!p) throw new Error('Unknown player');
        if (p.type !== 'human') throw new Error('Cannot rename CPU');
        const trimmed = String(name || '').trim().slice(0, 30);
        if (!trimmed) throw new Error('Name required');
        p.displayName = trimmed;
    }

    // Host-only, lobby-only config edits. Mutates in place or throws.
    // Currently only numPlayers is editable; the constraint set is small
    // enough that we don't bother with a generic partial-merge pattern.
    updateConfig(partial) {
        if (this.status !== 'lobby') throw new Error('Cannot change settings after game starts');
        if (partial.numPlayers !== undefined) {
            const n = Number(partial.numPlayers);
            if (![2, 4].includes(n)) throw new Error('Invalid player count');
            if (n < this.players.size) {
                throw new Error(`Already ${this.players.size} players seated — remove some before lowering`);
            }
            this.config.numPlayers = n;
        }
    }

    // Host-only: add a CPU player. Throws if lobby is full.
    addCpu(difficulty) {
        return this.addPlayer(null, null, this._nextCpuName(), {
            type: 'cpu',
            difficulty: difficulty || 'expert',
        });
    }

    _nextCpuName() {
        // CPU 1, CPU 2, ... — number them by order of addition for clarity.
        let n = 1;
        for (const p of this.players.values()) if (p.type === 'cpu') n++;
        return `CPU ${n}`;
    }

    // Host-only: remove a CPU. Humans must use removePlayer (via leave).
    removeCpu(playerId) {
        const p = this.players.get(playerId);
        if (!p) throw new Error('Unknown player');
        if (p.type !== 'cpu') throw new Error('Only CPUs can be removed this way');
        this.players.delete(playerId);
    }

    getPlayerByToken(token) {
        if (!token) return null;
        for (const [pid, p] of this.players) if (p.token === token) return pid;
        return null;
    }

    updateSocketId(playerId, socketId) {
        const p = this.players.get(playerId);
        if (!p) return;
        p.socketId = socketId;
        p.status   = 'lobby';
        p._disconnectedAt = null;
    }

    markDisconnected(playerId) {
        const p = this.players.get(playerId);
        if (!p) return;
        p.status = 'disconnected';
        p._disconnectedAt = Date.now();
    }

    // Total filled slots, including CPUs and disconnected humans (still in
    // their grace window). Used for capacity checks.
    seatedCount() {
        return this.players.size;
    }

    isFull() {
        return this.seatedCount() >= this.config.numPlayers;
    }

    // Host can start when:
    //   - they're the host
    //   - status is 'lobby'
    //   - exactly numPlayers seated (no empty slots)
    //   - no human is currently disconnected (otherwise we'd start a game
    //     with a phantom player)
    canStart(requesterPlayerId) {
        if (this.status !== 'lobby') return false;
        if (requesterPlayerId !== this.hostPlayerId) return false;
        if (!this.isFull()) return false;
        for (const p of this.players.values()) {
            if (p.type === 'human' && p.status !== 'lobby') return false;
        }
        return true;
    }

    // Build the playerConfigs map that GameRoom expects, indexed 1..N by
    // game-side player number. Order is by playerId (insertion order). Also
    // returns parallel arrays of human socket records so the caller can
    // register them with the GameRoom.
    buildGameSetup() {
        const seated = [...this.players.entries()]
            .sort(([a], [b]) => Number(a) - Number(b));
        if (seated.length !== this.config.numPlayers) {
            throw new Error(`Lobby has ${seated.length} players, expected ${this.config.numPlayers}`);
        }
        const playerConfigs = {};
        const humans        = [];   // { playerNumber, socketId, token, lobbyPlayerId }
        seated.forEach(([lobbyPlayerId, p], idx) => {
            const playerNumber = idx + 1;
            playerConfigs[playerNumber] = p.type === 'cpu'
                ? { type: 'cpu', difficulty: p.difficulty }
                : { type: 'human' };
            if (p.type === 'human') {
                humans.push({ playerNumber, socketId: p.socketId, token: p.token, lobbyPlayerId, displayName: p.displayName });
            }
        });
        return { playerConfigs, humans };
    }

    // JSON-safe snapshot for clients. Strips socketId + token + transient
    // disconnect timestamp (server-only).
    getState() {
        const players = [];
        for (const [playerId, p] of this.players) {
            players.push({
                playerId,
                displayName: p.displayName,
                type:        p.type,
                difficulty:  p.difficulty,
                status:      p.status,
            });
        }
        return {
            id:           this.id,
            status:       this.status,
            config:       this.config,
            hostPlayerId: this.hostPlayerId,
            players,
        };
    }
}

module.exports = Lobby;
