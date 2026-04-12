'use strict';

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const GameRoom = require('./GameRoom');

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
const GAMELOGS_DIR = path.join(__dirname, '..', 'gamelogs');
const LEARNED_FILE = path.join(GAMELOGS_DIR, 'learned.json');

function ensureGamelogsDir() {
    if (!fs.existsSync(GAMELOGS_DIR)) fs.mkdirSync(GAMELOGS_DIR, { recursive: true });
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

// POST /api/save-game — save game log text + structured move data
app.post('/api/save-game', (req, res) => {
    try {
        const { logText, moveData } = req.body;
        if (!logText) return res.status(400).json({ error: 'No log text' });

        ensureGamelogsDir();
        const num = nextGameNumber();
        const filename = `${num}.txt`;
        fs.writeFileSync(path.join(GAMELOGS_DIR, filename), logText);
        console.log(`Game ${num} saved to gamelogs/${filename}`);

        // Analyze blunders if structured move data is provided
        let blunders = [];
        if (moveData && moveData.moves) {
            blunders = analyzeBlunders(moveData);
            const learned = loadLearned();
            learned.blunders.push(...blunders);
            learned.gamesAnalyzed++;
            // Keep last 200 blunders
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

// ─── CPU move scheduling ──────────────────────────────────────────────────────
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
        room.applyMove({ type: '__skip' }, player);
        broadcastState(room, null);
        scheduleCpuMove(room);
        return;
    }

    room.applyMove(move, player);
    broadcastState(room, move);

    if (!room.gameOver) scheduleCpuMove(room);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function broadcastState(room, lastMove) {
    const state = room.getMaskedState();
    io.to(room.gameId).emit('state-update', { state, lastMove });
}

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[connect] ${socket.id}`);

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
    // payload: { gameId, token, move }
    socket.on('make-move', ({ gameId, token, move }) => {
        const room = rooms.get(gameId);
        if (!room) { socket.emit('error', { message: 'Game not found' }); return; }

        const playerNumber = room.getPlayerByToken(token);
        if (!playerNumber) { socket.emit('error', { message: 'Invalid token' }); return; }

        const result = room.applyMove(move, playerNumber);
        if (!result.valid) {
            socket.emit('move-rejected', { reason: result.error });
            return;
        }

        broadcastState(room, move);

        if (room.gameOver) {
            scheduleRoomCleanup(gameId);
        } else {
            scheduleCpuMove(room);
        }
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
    });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`Skillego server running on http://localhost:${PORT}`);
    console.log(`Configure port via PORT env var or a .env file`);
});
