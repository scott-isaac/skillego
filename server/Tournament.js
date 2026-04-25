'use strict';

const { buildBracket } = require('./lib/bracket');

// Status values a player holds while the tournament is running:
//   'lobby'       — tournament hasn't started yet
//   'waiting'     — in the bracket, current match not yet ready-to-start
//   'ready'       — clicked Ready; waiting for opponent
//   'playing'     — currently in a game
//   'eliminated'  — lost a match
//   'forfeited'   — lost via timeout or explicit forfeit
//
// Tournament.status:
//   'lobby'   — accepting joiners, host hasn't pressed start
//   'running' — bracket built, matches can begin
//   'done'    — champion decided
class Tournament {
    constructor(id, config) {
        this.id = id;
        this.status = 'lobby';
        this.config = {
            playerCount: config.playerCount,           // 2, 4, 8, or 16
            matchFormat: config.matchFormat,           // 3, 5, 7  (best-of)
            timeoutMs:   config.timeoutMs,             // per-match ready-up timeout
            enabledAbilities: config.enabledAbilities || [],
        };
        this.players      = new Map();  // playerId → { socketId, token, displayName, seed, status }
        this.hostPlayerId = null;
        this.bracket      = null;       // built on start()
        this.champion     = null;
        this._nextPlayerId = 1;
    }

    // opts: { type: 'human' | 'cpu' | 'observer', difficulty?: 'easy'|'medium'|'hard'|'expert' }
    // Human players have a real socketId + token. CPUs use null for both and
    // are never sent messages or queried by token.
    // Observers are people who joined via the share link after the tournament
    // started (or when it was already full). They don't take a bracket slot,
    // but can still spectate matches via the shared token.
    addPlayer(socketId, token, displayName, opts = {}) {
        const playerId = String(this._nextPlayerId++);
        const isObserver = opts.type === 'observer';
        this.players.set(playerId, {
            socketId,
            token,
            displayName,
            // Observers get a high seed so any accidental seed-based sort puts
            // them at the back; they're excluded from bracket seeding explicitly.
            seed: isObserver ? 9999 : this.players.size,
            status: isObserver ? 'observing' : 'lobby',
            type: opts.type || 'human',
            difficulty: opts.type === 'cpu' ? (opts.difficulty || 'expert') : null,
        });
        return playerId;
    }

    _activePlayerCount() {
        let n = 0;
        for (const p of this.players.values()) if (p.type !== 'observer') n++;
        return n;
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
    }

    // Host-only, lobby-only config edits. Mutates in place or throws. `partial`
    // may include any subset of { playerCount, matchFormat, timeoutMs, enabledAbilities }.
    updateConfig(partial) {
        if (this.status !== 'lobby') throw new Error('Cannot change settings after tournament starts');
        const c = this.config;
        if (partial.playerCount !== undefined) {
            const n = Number(partial.playerCount);
            if (![2, 4, 8, 16].includes(n)) throw new Error('Invalid player count');
            if (n < this.players.size) throw new Error(`Already have ${this.players.size} players — remove some before lowering`);
            c.playerCount = n;
        }
        if (partial.matchFormat !== undefined) {
            const f = Number(partial.matchFormat);
            if (![3, 5, 7].includes(f)) throw new Error('Invalid match format');
            c.matchFormat = f;
        }
        if (partial.timeoutMs !== undefined) {
            const ms = Number(partial.timeoutMs);
            if (!Number.isFinite(ms) || ms < 60 * 1000 || ms > 30 * 60 * 1000) {
                throw new Error('Timeout must be between 1 and 30 minutes');
            }
            c.timeoutMs = ms;
        }
        if (partial.enabledAbilities !== undefined) {
            if (!Array.isArray(partial.enabledAbilities)) throw new Error('Abilities must be an array');
            c.enabledAbilities = partial.enabledAbilities.slice();
        }
    }

    getPlayerByToken(token) {
        for (const [pid, p] of this.players) if (p.token === token) return pid;
        return null;
    }

    updateSocketId(playerId, socketId) {
        const p = this.players.get(playerId);
        if (p) p.socketId = socketId;
    }

    isFull() {
        return this._activePlayerCount() >= this.config.playerCount;
    }

    canStart(requesterPlayerId) {
        return this.status === 'lobby'
            && this.isFull()
            && requesterPlayerId === this.hostPlayerId;
    }

    start() {
        if (this.status !== 'lobby') throw new Error('Tournament already started');
        if (!this.isFull()) throw new Error('Tournament not full');

        // Observers never sit in bracket slots.
        const seededIds = [...this.players.keys()]
            .filter(id => this.players.get(id).type !== 'observer')
            .sort((a, b) => this.players.get(a).seed - this.players.get(b).seed);
        this.bracket = buildBracket(seededIds);
        this.status  = 'running';

        // Round-1 matches are immediately eligible for ready-up
        for (const m of this.bracket.rounds[0]) {
            this._prepareMatchForReadyUp(m);
        }
    }

    // Called whenever a match has both slots resolved and no game in progress —
    // transitions the match to 'ready-up' and flips both players to 'waiting'
    // so the lobby UI renders their Ready button.
    _prepareMatchForReadyUp(match) {
        match.status  = 'ready-up';
        match.gameRoomId = null;
        const a = this.players.get(match.slotA.playerId);
        const b = this.players.get(match.slotB.playerId);
        if (a && a.status !== 'eliminated' && a.status !== 'forfeited') a.status = 'waiting';
        if (b && b.status !== 'eliminated' && b.status !== 'forfeited') b.status = 'waiting';
        // CPU slots auto-ready — they have no socket to click a button.
        match.readyA = !!(a && a.type === 'cpu');
        match.readyB = !!(b && b.type === 'cpu');
        if (match.readyA && a) a.status = 'ready';
        if (match.readyB && b) b.status = 'ready';
    }

    // JSON-serializable snapshot for clients. Deliberately omits socketId + token
    // (not exposed to other players) and any underscore-prefixed match fields
    // (server-only transients like setTimeout handles).
    getState() {
        const players = [];
        for (const [playerId, p] of this.players) {
            players.push({
                playerId,
                displayName: p.displayName,
                seed: p.seed,
                status: p.status,
                type: p.type,
                difficulty: p.difficulty,
            });
        }
        let bracket = null;
        if (this.bracket) {
            bracket = {
                rounds: this.bracket.rounds.map(round => round.map(m => {
                    const out = {};
                    for (const k of Object.keys(m)) {
                        if (k.startsWith('_')) continue;
                        out[k] = m[k];
                    }
                    return out;
                })),
            };
        }
        return {
            id: this.id,
            status: this.status,
            config: this.config,
            hostPlayerId: this.hostPlayerId,
            players,
            bracket,
            champion: this.champion,
        };
    }
}

module.exports = Tournament;
