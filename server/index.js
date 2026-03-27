'use strict';

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const GameRoom = require('./GameRoom');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3000;

// ─── Static files ─────────────────────────────────────────────────────────────
// Serve the client from the repo root so localhost:PORT loads the game directly.
app.use(express.static(path.join(__dirname, '..')));

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

        socket.emit('game-rejoined', {
            gameId,
            playerNumber,
            state: room.getMaskedState(),
        });

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

    // ── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`[disconnect] ${socket.id}`);
        // Players have 10 minutes to rejoin before the room is cleaned up.
        // The game continues (CPU still moves, other players still play).
    });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`Skillego server running on http://localhost:${PORT}`);
    console.log(`Configure port via PORT env var or a .env file`);
});
