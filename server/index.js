'use strict';

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const GameRoom = require('./GameRoom');
const Tournament = require('./Tournament');
const Lobby = require('./Lobby');
const { getPlayerCurrentMatch, findMatch, advanceWinner } = require('./lib/bracket');
const { ALL_ABILITY_IDS } = require('./lib/constants');

const SERVER_FEATURES = ['tournament', 'lobby'];

const app    = express();
const server = http.createServer(app);

// Allow cross-origin connections from GitHub Pages (or any origin in dev).
// In production, lock this down to your specific GitHub Pages URL.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS[0] === '*' ? '*' : ALLOWED_ORIGINS,
        methods: ['GET', 'POST'],
    },
});

const PORT = process.env.PORT || 3000;

// ─── Static files ─────────────────────────────────────────────────────────────
// In local dev, serve client from repo root. In Docker (production), client
// is on GitHub Pages — the container is a backend-only WebSocket server.
const clientDir = path.join(__dirname, '..');
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
}
app.use(express.json({ limit: '1mb' }));

// ─── Game log auto-save + learning ────────────────────────────────────────────
const GAMELOGS_DIR    = path.join(__dirname, '..', 'gamelogs');
const LEARNED_FILE    = path.join(GAMELOGS_DIR, 'learned.json');
const TOURNAMENTS_DIR = path.join(GAMELOGS_DIR, 'tournaments');

function ensureGamelogsDir() {
    if (!fs.existsSync(GAMELOGS_DIR)) fs.mkdirSync(GAMELOGS_DIR, { recursive: true });
}

function tournamentDir(tournamentId)   { return path.join(TOURNAMENTS_DIR, tournamentId); }
function tournamentGamesDir(tournamentId) { return path.join(tournamentDir(tournamentId), 'games'); }
function tournamentSummaryPath(tournamentId) { return path.join(tournamentDir(tournamentId), 'summary.json'); }

function ensureTournamentDir(tournamentId) {
    const dir = tournamentDir(tournamentId);
    const games = tournamentGamesDir(tournamentId);
    if (!fs.existsSync(dir))   fs.mkdirSync(dir,   { recursive: true });
    if (!fs.existsSync(games)) fs.mkdirSync(games, { recursive: true });
}

// Read/update/write tournament summary, merging a partial patch onto disk.
function loadTournamentSummary(tournamentId) {
    const p = tournamentSummaryPath(tournamentId);
    try {
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        console.error(`Failed to read tournament summary ${tournamentId}:`, e.message);
    }
    return null;
}

function saveTournamentSummary(tournamentId, data) {
    ensureTournamentDir(tournamentId);
    fs.writeFileSync(tournamentSummaryPath(tournamentId), JSON.stringify(data, null, 2));
}

// Build a summary snapshot from the live Tournament instance. Called whenever
// state-changing events happen (start, match result, tournament over).
function snapshotTournament(t) {
    const state = t.getState();
    return {
        id:          state.id,
        status:      state.status,
        config:      state.config,
        hostPlayerId: state.hostPlayerId,
        players: state.players.map(p => ({
            playerId:    p.playerId,
            displayName: p.displayName,
            type:        p.type,
            difficulty:  p.difficulty,
            seed:        p.seed,
            finalStatus: p.status,
        })),
        bracket:     state.bracket,
        champion:    state.champion,
    };
}

function writeTournamentSummary(t, extras = {}) {
    const existing = loadTournamentSummary(t.id) || {};
    const snap     = snapshotTournament(t);
    const merged   = { ...existing, ...snap, ...extras };
    // Preserve first-seen createdAt across updates.
    if (!merged.createdAt) merged.createdAt = existing.createdAt || new Date().toISOString();
    merged.updatedAt = new Date().toISOString();
    if (merged.status === 'done' && !merged.completedAt) merged.completedAt = merged.updatedAt;
    saveTournamentSummary(t.id, merged);
}

function nextGameNumber() {
    ensureGamelogsDir();
    const files = fs.readdirSync(GAMELOGS_DIR).filter(f => /^\d+\.txt$/.test(f));
    const nums = files.map(f => parseInt(f));
    return nums.length ? Math.max(...nums) + 1 : 1;
}

function loadLearned() {
    try {
        if (fs.existsSync(LEARNED_FILE)) return JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8'));
    } catch (e) { console.error('Failed to load learned.json:', e.message); }
    return { blunders: [], weights: {}, gamesAnalyzed: 0 };
}

function saveLearned(data) {
    ensureGamelogsDir();
    fs.writeFileSync(LEARNED_FILE, JSON.stringify(data, null, 2));
}

// Analyze a game for true blunders — CPU moves that were punished AND:
//   1. The CPU had other moves (not forced)
//   2. The human's capture was NOT immediately recaptured (not a trade)
// An uncover that reveals a piece next to an enemy that captures it is always a blunder.
function analyzeBlunders(gameData) {
    const { moves, cpuPlayer } = gameData;
    const humanPlayer = cpuPlayer === 1 ? 2 : 1;
    const blunders = [];

    for (let i = 0; i < moves.length - 1; i++) {
        const cpuMove = moves[i];
        const humanReply = moves[i + 1];
        if (cpuMove.player !== cpuPlayer) continue;
        if (!humanReply || humanReply.player === cpuPlayer) continue;

        // Did the human capture a CPU piece on the next move?
        if (!humanReply.captured || humanReply.captured.player !== cpuPlayer) continue;

        // Check if this was a forced move (only 1 non-uncover CPU move in this turn).
        // Count how many CPU moves happened at the same turn number.
        const sameTurnCpuMoves = moves.filter(m =>
            m.turn === cpuMove.turn && m.player === cpuPlayer && m.type !== 'uncover'
        );
        // If the CPU's only option was this one move, it's not a blunder (forced).
        // But uncovers next to enemies are always blunders — the CPU chose WHERE to uncover.
        const wasForced = cpuMove.type !== 'uncover' && sameTurnCpuMoves.length <= 1
            && moves.filter(m => m.turn === cpuMove.turn && m.player === cpuPlayer).length <= 1;

        // Check if the human's capturing piece was recaptured on the very next CPU move.
        // If so, it's a trade, not a blunder.
        const nextCpuMove = moves[i + 2];
        const wasRecaptured = nextCpuMove
            && nextCpuMove.player === cpuPlayer
            && nextCpuMove.captured
            && nextCpuMove.captured.player === humanPlayer;

        if (wasForced || wasRecaptured) continue;

        blunders.push({
            turn: cpuMove.turn,
            cpuMoveType: cpuMove.type,
            cpuPiece: cpuMove.piece,
            cpuFrom: cpuMove.from,
            cpuTo: cpuMove.to,
            capturedBy: humanReply.piece,
            capturedPiece: humanReply.captured,
            lostPower: humanReply.captured.power,
        });
    }
    return blunders;
}

// POST /api/save-game — save game log text + structured move data.
// Payload: { logText, moveData, gameId? }
// If gameId identifies a tournament-linked GameRoom, the log + moves are
// archived under gamelogs/tournaments/<tid>/games/ instead of the flat root,
// and the tournament's summary.json is updated with a pointer.
app.post('/api/save-game', (req, res) => {
    try {
        const { logText, moveData, gameId } = req.body;
        if (!logText) return res.status(400).json({ error: 'No log text' });

        ensureGamelogsDir();

        // Route tournament-linked games to the tournament archive.
        const room = gameId ? rooms.get(gameId) : null;
        if (room && room.tournamentId && room.matchId) {
            const tid        = room.tournamentId;
            const matchId    = room.matchId;
            const gameInMatch = room.gameInMatch || 1;
            ensureTournamentDir(tid);
            const baseName   = `${matchId}-G${gameInMatch}`;
            const logPath    = path.join(tournamentGamesDir(tid), `${baseName}.txt`);
            const movesPath  = path.join(tournamentGamesDir(tid), `${baseName}.json`);

            // First writer wins — don't clobber if another client already uploaded
            // the same game. (Both players in a 1v1 trigger saveToServer.)
            if (!fs.existsSync(logPath)) {
                fs.writeFileSync(logPath, logText);
                if (moveData) {
                    fs.writeFileSync(movesPath, JSON.stringify({
                        tournamentId: tid, matchId, gameInMatch, gameRoomId: gameId,
                        ...moveData,
                    }, null, 2));
                }
                console.log(`[T:${tid}][${matchId}] Game ${gameInMatch} archived as ${baseName}.{txt,json}`);

                // Record the game pointer in the tournament summary (append-once).
                const summary = loadTournamentSummary(tid);
                if (summary) {
                    summary.games = summary.games || [];
                    if (!summary.games.some(g => g.file === `${baseName}.txt`)) {
                        summary.games.push({
                            matchId,
                            gameInMatch,
                            gameRoomId:  gameId,
                            file:        `${baseName}.txt`,
                            movesFile:   moveData ? `${baseName}.json` : null,
                            savedAt:     new Date().toISOString(),
                        });
                        summary.updatedAt = new Date().toISOString();
                        saveTournamentSummary(tid, summary);
                    }
                }
            }
            return res.json({ saved: `tournaments/${tid}/games/${baseName}.txt`, blunders: 0 });
        }

        // Standalone game — original flat numbering.
        const num = nextGameNumber();
        const filename = `${num}.txt`;
        fs.writeFileSync(path.join(GAMELOGS_DIR, filename), logText);
        console.log(`Game ${num} saved to gamelogs/${filename}`);

        let blunders = [];
        if (moveData && moveData.moves) {
            blunders = analyzeBlunders(moveData);
            const learned = loadLearned();
            learned.blunders.push(...blunders);
            learned.gamesAnalyzed++;
            if (learned.blunders.length > 200) learned.blunders = learned.blunders.slice(-200);
            saveLearned(learned);
            console.log(`  → ${blunders.length} blunders detected, ${learned.blunders.length} total patterns`);
        }

        res.json({ saved: filename, blunders: blunders.length });
    } catch (e) {
        console.error('Failed to save game:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/tournaments — list archived tournaments (summaries only).
app.get('/api/tournaments', (req, res) => {
    try {
        if (!fs.existsSync(TOURNAMENTS_DIR)) return res.json({ tournaments: [] });
        const ids = fs.readdirSync(TOURNAMENTS_DIR)
            .filter(f => fs.statSync(path.join(TOURNAMENTS_DIR, f)).isDirectory());
        const tournaments = ids.map(id => {
            const s = loadTournamentSummary(id);
            if (!s) return null;
            return {
                id,
                status:       s.status,
                createdAt:    s.createdAt,
                completedAt:  s.completedAt,
                playerCount:  s.config?.playerCount,
                matchFormat:  s.config?.matchFormat,
                champion:     s.champion,
                playerNames:  (s.players || []).map(p => p.displayName),
                gameCount:    (s.games || []).length,
            };
        }).filter(Boolean).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        res.json({ tournaments });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/tournaments/:id — full summary for one tournament.
app.get('/api/tournaments/:id', (req, res) => {
    const s = loadTournamentSummary(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json(s);
});

// GET /api/tournaments/:id/games/:file — stream one archived game's log or JSON.
app.get('/api/tournaments/:id/games/:file', (req, res) => {
    const id = req.params.id;
    const file = req.params.file;
    // Reject anything but simple alphanumeric + dash + dot names — no path traversal.
    if (!/^[A-Za-z0-9_\-]+\.(txt|json)$/.test(file)) return res.status(400).end();
    const p = path.join(tournamentGamesDir(id), file);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.type(file.endsWith('.json') ? 'application/json' : 'text/plain');
    res.send(fs.readFileSync(p));
});

// GET /api/learned — retrieve learned weight adjustments for the AI
app.get('/api/learned', (req, res) => {
    res.json(loadLearned());
});

// ─── Room store ───────────────────────────────────────────────────────────────
// gameId → GameRoom. In-memory only; restarts clear all games.
const rooms = new Map();

// Clean up finished rooms after 10 minutes
function scheduleRoomCleanup(gameId) {
    setTimeout(() => rooms.delete(gameId), 10 * 60 * 1000);
}

// ─── Tournament store ─────────────────────────────────────────────────────────
// tournamentId → Tournament. In-memory only. Separate Socket.io namespace per
// tournament uses the room key 'T:' + tournamentId so broadcasts don't collide
// with a game room that happens to share an id prefix.
const tournaments = new Map();
const T_ROOM = (tournamentId) => 'T:' + tournamentId;
const M_ROOM = (tournamentId, matchId) => 'M:' + tournamentId + ':' + matchId;

function scheduleTournamentCleanup(tournamentId) {
    setTimeout(() => tournaments.delete(tournamentId), 15 * 60 * 1000);
}

function broadcastTournamentState(t) {
    io.to(T_ROOM(t.id)).emit('tournament-state', { state: t.getState() });
}

// ─── Lobby store ──────────────────────────────────────────────────────────────
// lobbyId → Lobby. Each lobby maps to one upcoming game; once the host
// starts, the lobby spawns a GameRoom and is disposed.
const lobbies = new Map();
const L_ROOM = (lobbyId) => 'L:' + lobbyId;
const LOBBY_DISCONNECT_GRACE_MS = 30 * 1000;

// playerId → setTimeout handle for the disconnect grace period. When a
// player's socket disconnects we mark them disconnected and start a timer
// that removes them after the grace window unless they reconnect first.
const _lobbyDisconnectTimers = new Map();
function _disconnectTimerKey(lobbyId, playerId) { return lobbyId + ':' + playerId; }

function scheduleLobbyCleanup(lobbyId) {
    setTimeout(() => lobbies.delete(lobbyId), 10 * 60 * 1000);
}

function broadcastLobbyState(lobby) {
    io.to(L_ROOM(lobby.id)).emit('lobby-state', { state: lobby.getState() });
}

function clearLobbyDisconnectTimer(lobbyId, playerId) {
    const key = _disconnectTimerKey(lobbyId, playerId);
    const handle = _lobbyDisconnectTimers.get(key);
    if (handle) {
        clearTimeout(handle);
        _lobbyDisconnectTimers.delete(key);
    }
}

function startLobbyDisconnectTimer(lobby, playerId) {
    const key = _disconnectTimerKey(lobby.id, playerId);
    clearLobbyDisconnectTimer(lobby.id, playerId);
    const handle = setTimeout(() => {
        _lobbyDisconnectTimers.delete(key);
        // Lobby may have been disposed (game started) or the player already
        // reclaimed their slot; both are safe no-ops.
        if (!lobbies.has(lobby.id)) return;
        const p = lobby.players.get(playerId);
        if (!p || p.status !== 'disconnected') return;
        lobby.removePlayer(playerId);
        if (lobby.players.size === 0) {
            // Empty lobby — drop it.
            lobbies.delete(lobby.id);
            return;
        }
        broadcastLobbyState(lobby);
        console.log(`[L:${lobby.id}] P${playerId} removed after grace window`);
    }, LOBBY_DISCONNECT_GRACE_MS);
    _lobbyDisconnectTimers.set(key, handle);
}

// ─── Ready-up timeouts ────────────────────────────────────────────────────────
// Match objects get three non-serialized fields:
//   _timeoutHandle    — setTimeout id, cleared on cancel
//   _timeoutExtended  — flag: already used the half-timeout extension
// These are intentionally not in bracket.js (non-serializable) or getState()
// (we broadcast readyDeadline instead for the countdown UI).
function _armMatchTimeout(t, match) {
    _cancelMatchTimeout(match);
    match._timeoutExtended = false;
    match.readyDeadline    = Date.now() + t.config.timeoutMs;
    match._timeoutHandle   = setTimeout(() => _onMatchTimeout(t, match), t.config.timeoutMs);
}

// Arm the ready-up timer only if exactly one side has readied — the "race"
// semantics: once a player is ready, the opponent has the configured window
// to respond or forfeit. Nobody ready → no timer (wait forever). Both ready
// → timer cancelled and the caller should start the match.
function _maybeArmReadyTimer(t, match) {
    if (match.status !== 'ready-up') return;
    const both = match.readyA && match.readyB;
    const one  = match.readyA !== match.readyB;
    if (both || !one) {
        _cancelMatchTimeout(match);
    } else if (!match._timeoutHandle) {
        _armMatchTimeout(t, match);
    }
}

function _cancelMatchTimeout(match) {
    if (match._timeoutHandle) clearTimeout(match._timeoutHandle);
    match._timeoutHandle   = null;
    match._timeoutExtended = false;
    match.readyDeadline    = null;
}

function _onMatchTimeout(t, match) {
    match._timeoutHandle = null;
    if (match.status !== 'ready-up') return;

    if (match.readyA && !match.readyB) {
        _forfeitMatch(t, match, match.slotA.playerId, match.slotB.playerId);
    } else if (match.readyB && !match.readyA) {
        _forfeitMatch(t, match, match.slotB.playerId, match.slotA.playerId);
    } else if (!match._timeoutExtended) {
        // Nobody ready — extend once by half the timeout
        match._timeoutExtended = true;
        const extension = Math.floor(t.config.timeoutMs / 2);
        match.readyDeadline    = Date.now() + extension;
        match._timeoutHandle   = setTimeout(() => _onMatchTimeout(t, match), extension);
        broadcastTournamentState(t);
    } else {
        // Nobody ready after the extension — double-forfeit. Propagate slotA
        // nominally so the bracket doesn't hang; both players' status = 'forfeited'.
        console.warn(`[T:${t.id}][${match.id}] Double-forfeit — nobody readied`);
        const nominalWinner = match.slotA.playerId;
        t.players.get(match.slotA.playerId).status = 'forfeited';
        t.players.get(match.slotB.playerId).status = 'forfeited';
        const winsNeeded = Math.ceil(t.config.matchFormat / 2);
        match.scoreA = winsNeeded;
        io.to(T_ROOM(t.id)).emit('tournament-match-result', {
            matchId:              match.id,
            scoreA:               match.scoreA,
            scoreB:               match.scoreB,
            matchComplete:        true,
            gameWinnerPlayerId:   null,
            matchWinnerPlayerId:  nominalWinner,
            forfeited:            true,
            doubleForfeit:        true,
        });
        _advanceAfterMatchComplete(t, match, nominalWinner, /*winnerAlsoForfeited=*/true);
    }
}

function _forfeitMatch(t, match, winnerPlayerId, forfeitedPlayerId) {
    const winsNeeded = Math.ceil(t.config.matchFormat / 2);
    if (match.slotA.playerId === winnerPlayerId) match.scoreA = winsNeeded;
    else match.scoreB = winsNeeded;

    t.players.get(forfeitedPlayerId).status = 'forfeited';
    console.log(`[T:${t.id}][${match.id}] Forfeit — ${t.players.get(forfeitedPlayerId).displayName} didn't ready`);

    io.to(T_ROOM(t.id)).emit('tournament-match-result', {
        matchId:              match.id,
        scoreA:               match.scoreA,
        scoreB:               match.scoreB,
        matchComplete:        true,
        gameWinnerPlayerId:   null,
        matchWinnerPlayerId:  winnerPlayerId,
        forfeited:            true,
    });
    _advanceAfterMatchComplete(t, match, winnerPlayerId, false);
}

function _advanceAfterMatchComplete(t, match, matchWinnerPlayerId, winnerAlsoForfeited) {
    _cancelMatchTimeout(match);
    const { nextMatch } = advanceWinner(t.bracket, match.id, matchWinnerPlayerId);

    if (!nextMatch) {
        t.status   = 'done';
        t.champion = matchWinnerPlayerId;
        const champ = t.players.get(matchWinnerPlayerId);
        if (champ && !winnerAlsoForfeited) champ.status = 'waiting';
        io.to(T_ROOM(t.id)).emit('tournament-over', {
            championPlayerId: t.champion,
            championName:     champ ? champ.displayName : null,
        });
        scheduleTournamentCleanup(t.id);
        console.log(`[T:${t.id}] Tournament complete — champion: ${champ?.displayName}`);
        writeTournamentSummary(t);
    } else {
        const aOk = typeof nextMatch.slotA.playerId === 'string';
        const bOk = typeof nextMatch.slotB.playerId === 'string';
        if (aOk && bOk) {
            t._prepareMatchForReadyUp(nextMatch);
            _maybeArmReadyTimer(t, nextMatch);
            if (nextMatch.readyA && nextMatch.readyB) {
                _cancelMatchTimeout(nextMatch);
                setTimeout(() => {
                    if (nextMatch.status === 'ready-up' && nextMatch.readyA && nextMatch.readyB) {
                        startMatchGame(t, nextMatch);
                    }
                }, 1500);
            }
        } else {
            const winner = t.players.get(matchWinnerPlayerId);
            if (winner && !winnerAlsoForfeited) winner.status = 'waiting';
        }
    }
    broadcastTournamentState(t);
}

// Spawn a new GameRoom for the given tournament match and notify the two players.
// Reuses each player's tournament token as their game token — the server's
// make-move validator just checks token→player binding on a specific room.
function startMatchGame(t, match) {
    const aTPlayer = t.players.get(match.slotA.playerId);
    const bTPlayer = t.players.get(match.slotB.playerId);
    if (!aTPlayer || !bTPlayer) {
        console.warn(`[T:${t.id}] startMatchGame: missing player record for match ${match.id}`);
        return;
    }

    const gameId = uuidv4().substring(0, 8).toUpperCase();
    // Mix human/CPU per-slot based on the tournament player's type.
    const playerConfigs = {
        1: aTPlayer.type === 'cpu' ? { type: 'cpu', difficulty: aTPlayer.difficulty } : { type: 'human' },
        2: bTPlayer.type === 'cpu' ? { type: 'cpu', difficulty: bTPlayer.difficulty } : { type: 'human' },
    };
    const gameInMatch = (match.scoreA + match.scoreB) + 1;
    const room = new GameRoom(gameId, 2, playerConfigs, [...t.config.enabledAbilities], {
        tournamentId: t.id,
        matchId:      match.id,
        gameInMatch,
    });
    // Only humans need a player slot registered with a token; CPUs play via
    // the server's move scheduler without any socket involvement.
    if (aTPlayer.type === 'human') room.addPlayer(1, aTPlayer.socketId, aTPlayer.token);
    if (bTPlayer.type === 'human') room.addPlayer(2, bTPlayer.socketId, bTPlayer.token);
    rooms.set(gameId, room);

    const aSock = aTPlayer.type === 'human' ? io.sockets.sockets.get(aTPlayer.socketId) : null;
    const bSock = bTPlayer.type === 'human' ? io.sockets.sockets.get(bTPlayer.socketId) : null;
    if (aSock) aSock.join(gameId);
    if (bSock) bSock.join(gameId);

    match.gameRoomId = gameId;
    match.status     = 'playing';
    aTPlayer.status  = 'playing';
    bTPlayer.status  = 'playing';

    const startPayload = (playerNumber) => ({
        tournamentId: t.id,
        matchId:      match.id,
        gameId,
        playerNumber,
        gameInMatch,
        matchFormat:  t.config.matchFormat,
        scoreA:       match.scoreA,
        scoreB:       match.scoreB,
        opponentName: playerNumber === 1 ? bTPlayer.displayName : aTPlayer.displayName,
    });
    if (aSock) aSock.emit('tournament-match-start', { ...startPayload(1), token: aTPlayer.token, state: room.getMaskedState() });
    if (bSock) bSock.emit('tournament-match-start', { ...startPayload(2), token: bTPlayer.token, state: room.getMaskedState() });

    // Re-push context to any existing spectators — gameRoomId just changed.
    io.to(M_ROOM(t.id, match.id)).emit('spectate-state', {
        tournamentId: t.id,
        matchId:      match.id,
        gameId,
        gameInMatch,
        matchFormat:  t.config.matchFormat,
        scoreA:       match.scoreA,
        scoreB:       match.scoreB,
        nameA:        aTPlayer.displayName,
        nameB:        bTPlayer.displayName,
        state:        room.getMaskedState(),
    });

    console.log(`[T:${t.id}][${match.id}] Game ${gameInMatch} (room ${gameId}) started — ${aTPlayer.displayName} vs ${bTPlayer.displayName}`);
    broadcastTournamentState(t);

    // Kick off CPU thinking if the starting player is a CPU (or both are).
    scheduleCpuMove(room);
}

// Called when a tournament-linked GameRoom reaches gameOver (via normal end,
// resign, or leave). Increments the match score, decides whether the match is
// over, advances the bracket if so, and auto-spawns the next game otherwise.
// winnerPlayerNumber is the 1-or-2 from GameRoom (slotA = 1, slotB = 2).
function handleTournamentGameOver(room, winnerPlayerNumber) {
    if (!room.tournamentId || !room.matchId) return;
    const t = tournaments.get(room.tournamentId);
    if (!t) return;
    const match = findMatch(t.bracket, room.matchId);
    if (!match || match.status !== 'playing') return;
    if (match.gameRoomId !== room.gameId) return; // stale event from old game in series

    if (winnerPlayerNumber === 1) match.scoreA++;
    else if (winnerPlayerNumber === 2) match.scoreB++;
    else return;

    const gameWinnerPlayerId = winnerPlayerNumber === 1 ? match.slotA.playerId : match.slotB.playerId;
    const winsNeeded = Math.ceil(t.config.matchFormat / 2);
    const matchComplete = match.scoreA >= winsNeeded || match.scoreB >= winsNeeded;
    const matchWinnerPlayerId = match.scoreA >= winsNeeded ? match.slotA.playerId
                              : match.scoreB >= winsNeeded ? match.slotB.playerId
                              : null;

    io.to(T_ROOM(t.id)).emit('tournament-match-result', {
        matchId:              match.id,
        scoreA:               match.scoreA,
        scoreB:               match.scoreB,
        matchComplete,
        gameWinnerPlayerId,
        matchWinnerPlayerId,
    });
    writeTournamentSummary(t);

    if (matchComplete) {
        const loserPlayerId = match.slotA.playerId === matchWinnerPlayerId
                            ? match.slotB.playerId : match.slotA.playerId;
        const loser = t.players.get(loserPlayerId);
        if (loser) loser.status = 'eliminated';
        _advanceAfterMatchComplete(t, match, matchWinnerPlayerId, false);
    } else {
        // Series continues — require both players to ready-up for the next game.
        // Match transitions back to 'ready-up', CPUs auto-ready, timer arms once
        // one side has clicked. Spectators remain subscribed via the M_ROOM.
        t._prepareMatchForReadyUp(match);
        _maybeArmReadyTimer(t, match);
        broadcastTournamentState(t);
        if (match.readyA && match.readyB) {
            // Both sides are CPU — proceed automatically.
            setTimeout(() => {
                if (match.status === 'ready-up' && match.readyA && match.readyB) {
                    _cancelMatchTimeout(match);
                    startMatchGame(t, match);
                }
            }, 1500);
        }
    }
}

// ─── Unified move dispatch ────────────────────────────────────────────────────
// Single code path for any applied move — human or CPU. Validates + applies,
// broadcasts state, handles game-over cleanup, fires the tournament hook, and
// schedules the next CPU move. Everything downstream of a move should be added
// here so we don't accumulate divergent CPU-vs-human bugs.
function dispatchMove(room, move, playerNumber, lastMoveForBroadcast) {
    const result = room.applyMove(move, playerNumber);
    if (!result.valid) return result;

    broadcastState(room, lastMoveForBroadcast !== undefined ? lastMoveForBroadcast : move);

    if (room.gameOver) {
        scheduleRoomCleanup(room.gameId);
        if (room.winner === 1 || room.winner === 2) {
            handleTournamentGameOver(room, room.winner);
        }
    } else {
        scheduleCpuMove(room);
    }
    return result;
}

// ─── CPU move scheduling ──────────────────────────────────────────────────────
// The CPU computes a move and hands it to dispatchMove — the same entry point
// human moves use. The CPU never applies or broadcasts on its own; it behaves
// like a client that happens to live in-process.
function scheduleCpuMove(room) {
    if (room.gameOver || !room.currentPlayerIsCpu()) return;
    setTimeout(() => executeCpuMove(room), room.cpuMoveDelay);
}

function executeCpuMove(room) {
    if (room.gameOver) return;

    const player = room.currentPlayer;
    io.to(room.gameId).emit('cpu-thinking', { player });

    const move = room.computeCpuMove();
    if (!move) {
        console.warn(`[${room.gameId}] CPU P${player} has no moves — ending turn`);
        // Send a null lastMove to the broadcast (legacy behavior) since a skip
        // isn't a user-visible move, but still route through dispatchMove so
        // game-over / tournament / next-CPU hooks all fire uniformly.
        dispatchMove(room, { type: '__skip' }, player, null);
        return;
    }

    dispatchMove(room, move, player);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function broadcastState(room, lastMove) {
    const state = room.getMaskedState();
    io.to(room.gameId).emit('state-update', { state, lastMove });
    if (room.tournamentId && room.matchId) {
        // Relay to spectator-only match room so observers see the same state.
        // Players never join M_ROOM — they're in room.gameId, so no duplicates.
        io.to(M_ROOM(room.tournamentId, room.matchId)).emit('state-update', { state, lastMove });
    }
}

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[connect] ${socket.id}`);
    // Tell the client which abilities this server's rules engine understands, so
    // it can strip ones we'd silently ignore (e.g. features added after deploy).
    socket.emit('server-capabilities', { abilities: ALL_ABILITY_IDS, features: SERVER_FEATURES });

    // ── create-game ──────────────────────────────────────────────────────────
    // payload: { numPlayers, playerConfigs, enabledAbilities }
    //   playerConfigs: { 1: {type:'human'|'cpu', difficulty?:'easy'|..}, 2: ..., }
    //   enabledAbilities: string[]  e.g. ['push','hop','transform']
    socket.on('create-game', ({ numPlayers, playerConfigs, enabledAbilities }) => {
        console.log(`[create-game] abilities: ${JSON.stringify(enabledAbilities)}`);
        const gameId = uuidv4().substring(0, 8).toUpperCase();
        const room   = new GameRoom(gameId, numPlayers, playerConfigs, enabledAbilities);

        rooms.set(gameId, room);
        socket.join(gameId);

        // Register the creator as the first human player slot (if any)
        const firstHumanSlot = room.nextOpenSlot();
        let playerNumber = null;
        let token = null;

        if (firstHumanSlot) {
            token        = uuidv4();
            playerNumber = firstHumanSlot;
            room.addPlayer(playerNumber, socket.id, token);
        }

        socket.emit('game-created', {
            gameId,
            playerNumber,
            token,
            state: room.getMaskedState(),
        });

        console.log(`[${gameId}] Created by ${socket.id} (P${playerNumber ?? 'spectator'})`);

        if (room.readyToStart()) {
            io.to(gameId).emit('game-started', { state: room.getMaskedState() });
            scheduleCpuMove(room);
        } else {
            socket.emit('waiting-for-players', { gameId, need: room.nextOpenSlot() });
        }
    });

    // ── join-game ────────────────────────────────────────────────────────────
    // payload: { gameId }
    socket.on('join-game', ({ gameId }) => {
        const room = rooms.get(gameId);
        if (!room) { socket.emit('error', { message: 'Game not found' }); return; }
        if (room.gameOver) { socket.emit('error', { message: 'Game already finished' }); return; }

        const slot = room.nextOpenSlot();
        if (!slot) { socket.emit('error', { message: 'Game is full' }); return; }

        const token = uuidv4();
        room.addPlayer(slot, socket.id, token);
        socket.join(gameId);

        socket.emit('game-joined', {
            gameId,
            playerNumber: slot,
            token,
            state: room.getMaskedState(),
        });

        console.log(`[${gameId}] P${slot} joined (${socket.id})`);

        if (room.readyToStart()) {
            io.to(gameId).emit('game-started', { state: room.getMaskedState() });
            scheduleCpuMove(room);
        }
    });

    // ── rejoin-game ──────────────────────────────────────────────────────────
    // Reconnects a player who lost their socket (tab refresh, network blip, etc.)
    // payload: { gameId, token }
    socket.on('rejoin-game', ({ gameId, token }) => {
        const room = rooms.get(gameId);
        if (!room) { socket.emit('error', { message: 'Game not found or expired' }); return; }

        const playerNumber = room.getPlayerByToken(token);
        if (!playerNumber) { socket.emit('error', { message: 'Invalid token' }); return; }

        // Update socket id and re-join the Socket.io room
        room.players.get(playerNumber).socketId = socket.id;
        socket.join(gameId);

        // If game hasn't started yet (still waiting for opponent), show waiting screen
        if (!room.readyToStart()) {
            socket.emit('game-created', {
                gameId,
                playerNumber,
                token,
                state: room.getMaskedState(),
            });
            socket.emit('waiting-for-players', { gameId });
            console.log(`[${gameId}] P${playerNumber} rejoined (still waiting for opponent)`);
            return;
        }

        socket.emit('game-rejoined', {
            gameId,
            playerNumber,
            state: room.getMaskedState(),
        });

        // Notify the other player that this player is back
        socket.to(gameId).emit('opponent-reconnected', { player: playerNumber });

        console.log(`[${gameId}] P${playerNumber} rejoined (${socket.id})`);
    });

    // ── make-move ────────────────────────────────────────────────────────────
    // Human clients emit this; the CPU goes through dispatchMove directly.
    // payload: { gameId, token, move }
    socket.on('make-move', ({ gameId, token, move }) => {
        const room = rooms.get(gameId);
        if (!room) { socket.emit('error', { message: 'Game not found' }); return; }

        const playerNumber = room.getPlayerByToken(token);
        if (!playerNumber) { socket.emit('error', { message: 'Invalid token' }); return; }

        const result = dispatchMove(room, move, playerNumber);
        if (!result.valid) socket.emit('move-rejected', { reason: result.error });
    });

    // ── resign ───────────────────────────────────────────────────────────────
    // payload: { gameId, token }
    socket.on('resign', ({ gameId, token }) => {
        const room = rooms.get(gameId);
        if (!room) return;
        const playerNumber = room.getPlayerByToken(token);
        if (!playerNumber) return;

        room.gameOver = true;
        // The OTHER player wins
        const winner = Array.from({ length: room.numPlayers }, (_, i) => i + 1)
            .find(p => p !== playerNumber && !room.eliminatedPlayers.has(p)) || null;
        room.winner = winner;

        io.to(gameId).emit('game-over', {
            state: room.getMaskedState(),
            winner,
            reason: `Player ${playerNumber} resigned`,
        });
        console.log(`[${gameId}] P${playerNumber} resigned → P${winner} wins`);
        scheduleRoomCleanup(gameId);
        if (winner === 1 || winner === 2) handleTournamentGameOver(room, winner);
    });

    // ── leave-game ───────────────────────────────────────────────────────────
    // Player leaves the room (after game over, or abandoning)
    // payload: { gameId, token }
    socket.on('leave-game', ({ gameId, token }) => {
        const room = rooms.get(gameId);
        if (!room) return;
        const playerNumber = room.getPlayerByToken(token);
        if (!playerNumber) return;

        room.players.delete(playerNumber);
        socket.leave(gameId);

        // Notify remaining players
        io.to(gameId).emit('opponent-left', { player: playerNumber });
        console.log(`[${gameId}] P${playerNumber} left`);

        // If the game was still going, the leaving player forfeits
        if (!room.gameOver) {
            room.gameOver = true;
            const winner = Array.from({ length: room.numPlayers }, (_, i) => i + 1)
                .find(p => p !== playerNumber && !room.eliminatedPlayers.has(p)) || null;
            room.winner = winner;
            io.to(gameId).emit('game-over', {
                state: room.getMaskedState(),
                winner,
                reason: `Player ${playerNumber} left`,
            });
            scheduleRoomCleanup(gameId);
            if (winner === 1 || winner === 2) handleTournamentGameOver(room, winner);
        }
    });

    // ── rematch ──────────────────────────────────────────────────────────────
    // Host requests a new game with the same settings and players
    // payload: { gameId, token }
    socket.on('rematch', ({ gameId, token }) => {
        const oldRoom = rooms.get(gameId);
        if (!oldRoom) { socket.emit('error', { message: 'Game not found' }); return; }
        const playerNumber = oldRoom.getPlayerByToken(token);
        if (!playerNumber) { socket.emit('error', { message: 'Invalid token' }); return; }

        // Create a new room with the same settings
        const newGameId = uuidv4().substring(0, 8).toUpperCase();
        const newRoom = new GameRoom(newGameId, oldRoom.numPlayers,
            oldRoom.playerConfigs, [...oldRoom.enabledAbilities]);
        rooms.set(newGameId, newRoom);

        // Migrate all connected players from the old room to the new one
        for (const [pNum, info] of oldRoom.players) {
            newRoom.addPlayer(pNum, info.socketId, info.token);
            const pSocket = io.sockets.sockets.get(info.socketId);
            if (pSocket) {
                pSocket.leave(gameId);
                pSocket.join(newGameId);
            }
        }

        // Notify all players
        io.to(newGameId).emit('rematch-started', {
            gameId: newGameId,
            state: newRoom.getMaskedState(),
        });

        if (newRoom.readyToStart()) {
            io.to(newGameId).emit('game-started', { state: newRoom.getMaskedState() });
            scheduleCpuMove(newRoom);
        }

        rooms.delete(gameId);
        console.log(`[${gameId}] Rematch → [${newGameId}]`);
    });

    // ── create-tournament ────────────────────────────────────────────────────
    // payload: { playerCount, matchFormat, timeoutMinutes, enabledAbilities, hostName }
    socket.on('create-tournament', ({ playerCount, matchFormat, timeoutMinutes, enabledAbilities, hostName }) => {
        if (![2, 4, 8, 16].includes(playerCount)) {
            socket.emit('error', { message: 'Invalid player count (must be 2, 4, 8, or 16)' });
            return;
        }
        if (![3, 5, 7].includes(matchFormat)) {
            socket.emit('error', { message: 'Invalid match format (must be 3, 5, or 7)' });
            return;
        }
        if (!hostName || typeof hostName !== 'string' || !hostName.trim()) {
            socket.emit('error', { message: 'Display name required' });
            return;
        }
        const timeoutMinutesNum = Number(timeoutMinutes);
        const safeMinutes = Number.isFinite(timeoutMinutesNum) && timeoutMinutesNum > 0 ? timeoutMinutesNum : 5;
        const timeoutMs = Math.min(Math.max(safeMinutes, 1), 30) * 60 * 1000;

        const tournamentId = uuidv4().substring(0, 8).toUpperCase();
        const t = new Tournament(tournamentId, {
            playerCount,
            matchFormat,
            timeoutMs,
            enabledAbilities: Array.isArray(enabledAbilities) ? enabledAbilities : [],
        });

        const hostToken = uuidv4();
        const hostPlayerId = t.addPlayer(socket.id, hostToken, hostName.trim().slice(0, 30));
        t.hostPlayerId = hostPlayerId;

        tournaments.set(tournamentId, t);
        socket.join(T_ROOM(tournamentId));

        socket.emit('tournament-created', {
            tournamentId,
            playerId: hostPlayerId,
            token:    hostToken,
            isHost:   true,
            state:    t.getState(),
        });
        console.log(`[T:${tournamentId}] Created by ${socket.id} as "${hostName}" (${playerCount}p BO${matchFormat}, ${Math.round(timeoutMs/60000)}min timeout)`);
        writeTournamentSummary(t);
    });

    // ── join-tournament ──────────────────────────────────────────────────────
    // Joining a tournament. If the tournament is in 'lobby' with room, the user
    // takes an open bracket slot as a player. Otherwise (running / done / full),
    // the user is admitted as an observer so they can still spectate matches
    // and view the bracket.
    // payload: { tournamentId, displayName }
    socket.on('join-tournament', ({ tournamentId, displayName }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found' }); return; }
        if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
            socket.emit('error', { message: 'Display name required' });
            return;
        }

        const name  = displayName.trim().slice(0, 30);
        const token = uuidv4();

        const asObserver = t.status !== 'lobby' || t.isFull();
        const playerId = t.addPlayer(socket.id, token, name, {
            type: asObserver ? 'observer' : 'human',
        });

        socket.join(T_ROOM(tournamentId));

        socket.emit('tournament-joined', {
            tournamentId,
            playerId,
            token,
            isHost: false,
            state:  t.getState(),
        });
        console.log(`[T:${tournamentId}] "${name}" joined as ${asObserver ? 'observer' : 'player'} (active ${t._activePlayerCount()}/${t.config.playerCount})`);
        broadcastTournamentState(t);
    });

    // ── rejoin-tournament ────────────────────────────────────────────────────
    // payload: { tournamentId, token }
    socket.on('rejoin-tournament', ({ tournamentId, token }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found or expired' }); return; }
        const playerId = t.getPlayerByToken(token);
        if (!playerId) { socket.emit('error', { message: 'Invalid tournament token' }); return; }

        t.updateSocketId(playerId, socket.id);
        socket.join(T_ROOM(tournamentId));

        socket.emit('tournament-joined', {
            tournamentId,
            playerId,
            token,
            isHost: playerId === t.hostPlayerId,
            state:  t.getState(),
        });
        console.log(`[T:${tournamentId}] P${playerId} rejoined`);
    });

    // ── update-tournament-config ─────────────────────────────────────────────
    // Host only, lobby only. Patch any subset of { playerCount, matchFormat,
    // timeoutMs, enabledAbilities } on a running tournament before it starts.
    // payload: { tournamentId, token, config }
    socket.on('update-tournament-config', ({ tournamentId, token, config }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found' }); return; }
        const playerId = t.getPlayerByToken(token);
        if (!playerId || playerId !== t.hostPlayerId) {
            socket.emit('error', { message: 'Only the host can change tournament settings' });
            return;
        }
        try {
            t.updateConfig(config || {});
        } catch (e) {
            socket.emit('error', { message: e.message });
            return;
        }
        console.log(`[T:${tournamentId}] Config updated:`, JSON.stringify(config));
        broadcastTournamentState(t);
    });

    // ── add-cpu-to-tournament ────────────────────────────────────────────────
    // Host only, lobby only. Fills one open slot with a CPU of the given difficulty.
    // payload: { tournamentId, token, difficulty }
    socket.on('add-cpu-to-tournament', ({ tournamentId, token, difficulty }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found' }); return; }
        if (t.status !== 'lobby') { socket.emit('error', { message: 'Tournament already started' }); return; }
        const requesterId = t.getPlayerByToken(token);
        if (!requesterId || requesterId !== t.hostPlayerId) {
            socket.emit('error', { message: 'Only the host can add CPU opponents' });
            return;
        }
        if (t.isFull()) { socket.emit('error', { message: 'Tournament is full' }); return; }
        const diff = ['easy', 'medium', 'hard', 'expert'].includes(difficulty) ? difficulty : 'expert';

        // Generate a unique CPU display name: CPU-easy, CPU-hard, or CPU-expert-2
        let base = `CPU-${diff}`, name = base, n = 1;
        const existing = new Set([...t.players.values()].map(p => p.displayName));
        while (existing.has(name)) { n++; name = `${base}-${n}`; }

        const playerId = t.addPlayer(null, null, name, { type: 'cpu', difficulty: diff });
        console.log(`[T:${tournamentId}] Host added CPU "${name}" (${playerId})`);
        broadcastTournamentState(t);
    });

    // ── remove-tournament-player ─────────────────────────────────────────────
    // Host only, lobby only. Removes any non-host player from the tournament.
    // payload: { tournamentId, token, targetPlayerId }
    socket.on('remove-tournament-player', ({ tournamentId, token, targetPlayerId }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found' }); return; }
        if (t.status !== 'lobby') { socket.emit('error', { message: 'Tournament already started' }); return; }
        const requesterId = t.getPlayerByToken(token);
        if (!requesterId || requesterId !== t.hostPlayerId) {
            socket.emit('error', { message: 'Only the host can remove players' });
            return;
        }
        if (targetPlayerId === t.hostPlayerId) {
            socket.emit('error', { message: 'Cannot remove the host' });
            return;
        }
        const target = t.players.get(targetPlayerId);
        if (!target) return;
        // Notify the removed human so they can leave the lobby cleanly.
        if (target.type === 'human' && target.socketId) {
            const targetSock = io.sockets.sockets.get(target.socketId);
            if (targetSock) {
                targetSock.emit('tournament-kicked', { tournamentId, reason: 'Removed by host' });
                targetSock.leave(T_ROOM(tournamentId));
            }
        }
        t.removePlayer(targetPlayerId);
        console.log(`[T:${tournamentId}] Host removed ${target.displayName}`);
        broadcastTournamentState(t);
    });

    // ── rename-tournament-player ─────────────────────────────────────────────
    // Players can change their displayName while the tournament is still in lobby.
    // payload: { tournamentId, token, displayName }
    socket.on('rename-tournament-player', ({ tournamentId, token, displayName }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found' }); return; }
        if (t.status !== 'lobby') { socket.emit('error', { message: 'Cannot rename after tournament starts' }); return; }
        const playerId = t.getPlayerByToken(token);
        if (!playerId) { socket.emit('error', { message: 'Invalid tournament token' }); return; }
        if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
            socket.emit('error', { message: 'Name cannot be empty' });
            return;
        }
        t.players.get(playerId).displayName = displayName.trim().slice(0, 30);
        broadcastTournamentState(t);
    });

    // ── start-tournament ─────────────────────────────────────────────────────
    // payload: { tournamentId, token }
    socket.on('start-tournament', ({ tournamentId, token }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found' }); return; }
        const playerId = t.getPlayerByToken(token);
        if (!playerId) { socket.emit('error', { message: 'Invalid tournament token' }); return; }
        if (playerId !== t.hostPlayerId) {
            socket.emit('error', { message: 'Only the host can start the tournament' });
            return;
        }
        if (t.status !== 'lobby') {
            socket.emit('error', { message: 'Tournament already started' });
            return;
        }
        if (!t.isFull()) {
            socket.emit('error', { message: `Need ${t.config.playerCount - t.players.size} more players` });
            return;
        }

        try {
            t.start();
        } catch (e) {
            socket.emit('error', { message: e.message });
            return;
        }
        // Round-0 matches start in ready-up with no timer. If exactly one side
        // is already ready (human vs CPU), arm the timer for the other side.
        // If both CPU, auto-start.
        for (const m of t.bracket.rounds[0]) {
            _maybeArmReadyTimer(t, m);
        }
        console.log(`[T:${tournamentId}] Started with ${t.players.size} players`);
        broadcastTournamentState(t);
        writeTournamentSummary(t);
        for (const m of t.bracket.rounds[0]) {
            if (m.status === 'ready-up' && m.readyA && m.readyB) {
                _cancelMatchTimeout(m);
                startMatchGame(t, m);
            }
        }
    });

    // ── match-ready ──────────────────────────────────────────────────────────
    // A tournament player clicks Ready for their current match. When both sides
    // are ready, startMatchGame() spawns a GameRoom and emits tournament-match-start.
    // payload: { tournamentId, token }
    socket.on('match-ready', ({ tournamentId, token }) => {
        const t = tournaments.get(tournamentId);
        if (!t || t.status !== 'running') { socket.emit('error', { message: 'Tournament not active' }); return; }
        const playerId = t.getPlayerByToken(token);
        if (!playerId) { socket.emit('error', { message: 'Invalid tournament token' }); return; }

        const match = getPlayerCurrentMatch(t.bracket, playerId);
        if (!match) { socket.emit('error', { message: 'No active match for you' }); return; }
        if (match.status !== 'ready-up') { socket.emit('error', { message: 'Match is not in ready-up state' }); return; }

        // Toggle semantics: clicking Ready again before the game starts unreadies.
        // This cancels the opponent's forfeit timer (it was armed because this
        // player was ready), and re-arms it fresh if the player re-confirms.
        let nowReady;
        if (match.slotA.playerId === playerId) {
            match.readyA = !match.readyA;
            nowReady = match.readyA;
        } else if (match.slotB.playerId === playerId) {
            match.readyB = !match.readyB;
            nowReady = match.readyB;
        } else {
            socket.emit('error', { message: 'You are not in this match' });
            return;
        }
        t.players.get(playerId).status = nowReady ? 'ready' : 'waiting';

        if (match.readyA && match.readyB) {
            _cancelMatchTimeout(match);
            startMatchGame(t, match);
        } else {
            _maybeArmReadyTimer(t, match);
            broadcastTournamentState(t);
        }
    });

    // ── spectate-match ───────────────────────────────────────────────────────
    // A tournament member asks to watch another match. They get the current
    // masked state and subsequent state-updates via the match-scoped room.
    // payload: { tournamentId, matchId, token }
    socket.on('spectate-match', ({ tournamentId, matchId, token }) => {
        const t = tournaments.get(tournamentId);
        if (!t) { socket.emit('error', { message: 'Tournament not found' }); return; }
        const playerId = t.getPlayerByToken(token);
        if (!playerId) { socket.emit('error', { message: 'Invalid tournament token' }); return; }

        const match = findMatch(t.bracket, matchId);
        if (!match) { socket.emit('error', { message: 'Match not found' }); return; }
        if (match.status !== 'playing' || !match.gameRoomId) {
            socket.emit('error', { message: 'Match is not currently playing' });
            return;
        }
        const room = rooms.get(match.gameRoomId);
        if (!room) { socket.emit('error', { message: 'Match game room expired' }); return; }

        socket.join(M_ROOM(tournamentId, matchId));

        const aPlayer = t.players.get(match.slotA.playerId);
        const bPlayer = t.players.get(match.slotB.playerId);
        socket.emit('spectate-state', {
            tournamentId,
            matchId,
            gameId:       room.gameId,
            gameInMatch:  room.gameInMatch,
            matchFormat:  t.config.matchFormat,
            scoreA:       match.scoreA,
            scoreB:       match.scoreB,
            nameA:        aPlayer ? aPlayer.displayName : '?',
            nameB:        bPlayer ? bPlayer.displayName : '?',
            state:        room.getMaskedState(),
        });
        console.log(`[T:${tournamentId}][${matchId}] P${playerId} started spectating`);
    });

    // ── stop-spectate ────────────────────────────────────────────────────────
    // payload: { tournamentId, matchId }
    socket.on('stop-spectate', ({ tournamentId, matchId }) => {
        if (!tournamentId || !matchId) return;
        socket.leave(M_ROOM(tournamentId, matchId));
    });

    // ── host-lobby ───────────────────────────────────────────────────────────
    // payload: { numPlayers, enabledAbilities, displayName }
    // Creates a new Lobby, seats the caller as host, returns lobby creds.
    socket.on('host-lobby', ({ numPlayers, enabledAbilities, displayName }) => {
        const n = Number(numPlayers) || 4;
        if (![2, 3, 4].includes(n)) {
            socket.emit('error', { message: 'Invalid player count for lobby' });
            return;
        }
        const lobbyId = uuidv4().substring(0, 8).toUpperCase();
        const lobby = new Lobby(lobbyId, {
            numPlayers:       n,
            enabledAbilities: Array.isArray(enabledAbilities) ? enabledAbilities : [],
        });
        const token = uuidv4();
        const playerId = lobby.addPlayer(socket.id, token, _safeDisplayName(displayName, 'Host'), { type: 'human' });
        lobby.hostPlayerId = playerId;
        lobbies.set(lobbyId, lobby);
        socket.join(L_ROOM(lobbyId));

        socket.emit('lobby-created', {
            lobbyId,
            playerId,
            token,
            state: lobby.getState(),
        });
        console.log(`[L:${lobbyId}] created by ${socket.id} as P${playerId}`);
    });

    // ── join-lobby ───────────────────────────────────────────────────────────
    // payload: { lobbyId, displayName, token? }
    // Token is optional — supplying a known one reclaims an existing slot
    // (used by the disconnect grace flow).
    socket.on('join-lobby', ({ lobbyId, displayName, token }) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) { socket.emit('error', { message: 'Lobby not found' }); return; }
        if (lobby.status !== 'lobby') { socket.emit('error', { message: 'Lobby already started' }); return; }

        // Existing player reconnecting via token?
        if (token) {
            const existingId = lobby.getPlayerByToken(token);
            if (existingId) {
                lobby.updateSocketId(existingId, socket.id);
                clearLobbyDisconnectTimer(lobbyId, existingId);
                socket.join(L_ROOM(lobbyId));
                socket.emit('lobby-joined', {
                    lobbyId,
                    playerId: existingId,
                    token,
                    state: lobby.getState(),
                });
                broadcastLobbyState(lobby);
                console.log(`[L:${lobbyId}] P${existingId} reconnected (${socket.id})`);
                return;
            }
        }

        // Fresh join.
        if (lobby.isFull()) { socket.emit('error', { message: 'Lobby is full' }); return; }
        const newToken = uuidv4();
        const playerId = lobby.addPlayer(socket.id, newToken, _safeDisplayName(displayName, `Player ${lobby.seatedCount() + 1}`), { type: 'human' });
        socket.join(L_ROOM(lobbyId));
        socket.emit('lobby-joined', {
            lobbyId,
            playerId,
            token: newToken,
            state: lobby.getState(),
        });
        broadcastLobbyState(lobby);
        console.log(`[L:${lobbyId}] P${playerId} joined (${socket.id})`);
    });

    // ── leave-lobby ──────────────────────────────────────────────────────────
    // payload: { lobbyId, token }
    socket.on('leave-lobby', ({ lobbyId, token }) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        const playerId = lobby.getPlayerByToken(token);
        if (!playerId) return;
        clearLobbyDisconnectTimer(lobbyId, playerId);
        lobby.removePlayer(playerId);
        socket.leave(L_ROOM(lobbyId));
        if (lobby.players.size === 0) {
            lobbies.delete(lobbyId);
            console.log(`[L:${lobbyId}] disposed (empty)`);
            return;
        }
        broadcastLobbyState(lobby);
        console.log(`[L:${lobbyId}] P${playerId} left`);
    });

    // ── rename-in-lobby ──────────────────────────────────────────────────────
    // payload: { lobbyId, token, name }
    socket.on('rename-in-lobby', ({ lobbyId, token, name }) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        const playerId = lobby.getPlayerByToken(token);
        if (!playerId) return;
        try {
            lobby.updateName(playerId, name);
            broadcastLobbyState(lobby);
        } catch (e) {
            socket.emit('error', { message: e.message });
        }
    });

    // ── update-lobby-config ──────────────────────────────────────────────────
    // payload: { lobbyId, token, numPlayers }
    // Host-only. Currently only numPlayers (2 or 4) is editable.
    socket.on('update-lobby-config', ({ lobbyId, token, numPlayers }) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        const playerId = lobby.getPlayerByToken(token);
        if (playerId !== lobby.hostPlayerId) {
            socket.emit('error', { message: 'Only the host can change settings' });
            return;
        }
        try {
            lobby.updateConfig({ numPlayers });
            broadcastLobbyState(lobby);
        } catch (e) {
            socket.emit('error', { message: e.message });
        }
    });

    // ── add-lobby-cpu ────────────────────────────────────────────────────────
    // payload: { lobbyId, token, difficulty }
    // Host-only.
    socket.on('add-lobby-cpu', ({ lobbyId, token, difficulty }) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        const playerId = lobby.getPlayerByToken(token);
        if (playerId !== lobby.hostPlayerId) {
            socket.emit('error', { message: 'Only the host can add CPUs' });
            return;
        }
        try {
            lobby.addCpu(difficulty);
            broadcastLobbyState(lobby);
        } catch (e) {
            socket.emit('error', { message: e.message });
        }
    });

    // ── remove-lobby-cpu ─────────────────────────────────────────────────────
    // payload: { lobbyId, token, playerId }  (playerId of the CPU to remove)
    socket.on('remove-lobby-cpu', ({ lobbyId, token, playerId: targetId }) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;
        const requesterId = lobby.getPlayerByToken(token);
        if (requesterId !== lobby.hostPlayerId) {
            socket.emit('error', { message: 'Only the host can remove CPUs' });
            return;
        }
        try {
            lobby.removeCpu(targetId);
            broadcastLobbyState(lobby);
        } catch (e) {
            socket.emit('error', { message: e.message });
        }
    });

    // ── start-lobby-game ─────────────────────────────────────────────────────
    // payload: { lobbyId, token }
    // Host clicks Start. We spawn a GameRoom from the lobby's player list,
    // register every human player's socket+token with the room, emit
    // lobby-game-started to all members with their per-player handoff
    // payload, then dispose the lobby.
    socket.on('start-lobby-game', ({ lobbyId, token }) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) { socket.emit('error', { message: 'Lobby not found' }); return; }
        const requesterId = lobby.getPlayerByToken(token);
        if (!lobby.canStart(requesterId)) {
            socket.emit('error', { message: 'Cannot start: lobby not ready' });
            return;
        }

        let setup;
        try {
            setup = lobby.buildGameSetup();
        } catch (e) {
            socket.emit('error', { message: e.message });
            return;
        }

        const gameId = uuidv4().substring(0, 8).toUpperCase();
        const room = new GameRoom(gameId, lobby.config.numPlayers, setup.playerConfigs, [...lobby.config.enabledAbilities]);
        rooms.set(gameId, room);

        // Register human players. Reuse their lobby tokens as game tokens
        // so the rest of the protocol (move validation by token) just works.
        for (const h of setup.humans) {
            room.addPlayer(h.playerNumber, h.socketId, h.token);
            const sock = io.sockets.sockets.get(h.socketId);
            if (sock) {
                sock.leave(L_ROOM(lobbyId));
                sock.join(gameId);
                sock.emit('lobby-game-started', {
                    lobbyId,
                    gameId,
                    playerNumber: h.playerNumber,
                    token:        h.token,
                    state:        room.getMaskedState(),
                });
            }
        }

        lobby.status = 'started';
        // Dispose lobby and any lingering disconnect timers.
        for (const pid of lobby.players.keys()) clearLobbyDisconnectTimer(lobbyId, pid);
        lobbies.delete(lobbyId);

        // CPU players don't get a socket event — the GameRoom's CPU
        // scheduler picks them up automatically once readyToStart() fires.
        if (room.readyToStart()) {
            io.to(gameId).emit('game-started', { state: room.getMaskedState() });
            scheduleCpuMove(room);
        }
        console.log(`[L:${lobbyId}] → ${gameId} started (${lobby.config.numPlayers}P)`);
    });

    // ── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`[disconnect] ${socket.id}`);
        // Notify rooms this socket was in
        for (const [gameId, room] of rooms) {
            for (const [pNum, info] of room.players) {
                if (info.socketId === socket.id) {
                    io.to(gameId).emit('opponent-disconnected', { player: pNum });
                    console.log(`[${gameId}] P${pNum} disconnected`);
                }
            }
        }
        // Lobbies: mark the player disconnected and start a grace timer.
        // If they reconnect via join-lobby with their token before the
        // window expires, they keep their slot. Otherwise they're removed.
        for (const [lobbyId, lobby] of lobbies) {
            for (const [playerId, p] of lobby.players) {
                if (p.socketId === socket.id) {
                    lobby.markDisconnected(playerId);
                    startLobbyDisconnectTimer(lobby, playerId);
                    broadcastLobbyState(lobby);
                    console.log(`[L:${lobbyId}] P${playerId} disconnected (grace started)`);
                }
            }
        }
        // Tournaments: don't kick anyone on a bare disconnect — the token-based
        // rejoin flow will reseat them. The UI uses freshness of socketId to
        // show a dimmed state for disconnected players.
    });
});

// Trim a display name and fall back to a sensible default if blank.
function _safeDisplayName(raw, fallback) {
    const trimmed = String(raw || '').trim().slice(0, 30);
    return trimmed || fallback;
}

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`Skillego server running on http://localhost:${PORT}`);
    console.log(`Configure port via PORT env var or a .env file`);
});
