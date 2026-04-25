'use strict';

// Pure single-elimination bracket helpers. No sockets, no persistence.
// A "playerId" here is a Tournament-scoped identifier (the tournamentPlayerId
// from Tournament.js — not a game-level playerNumber).
//
// Bracket shape:
//   { rounds: Round[] }
//   Round = Match[]
//   Match = {
//       id,          // stable string, unique within the bracket
//       round,       // 0-indexed round number
//       slotA,       // see Slot below
//       slotB,       // see Slot below
//       scoreA,      // games won by slotA's player
//       scoreB,      // games won by slotB's player
//       status,      // 'pending' | 'ready' | 'playing' | 'complete'
//       winnerPlayerId,  // filled when status === 'complete'
//   }
//
//   Slot = { playerId } | { fromMatchId } | { bye: true }
//   Round 0 slots are always { playerId } (or { bye: true } — but this module
//   requires powers-of-2 so byes never occur here).
//   Later rounds start with { fromMatchId } placeholders that get resolved as
//   earlier rounds finish.

const POWERS_OF_TWO = [2, 4, 8, 16, 32];

function isPowerOfTwo(n) {
    return n >= 2 && (n & (n - 1)) === 0;
}

// Build a fresh bracket from a seeded player list.
// seededIds.length must be a power of 2 (callers enforce this via config).
// Seeding is positional: seededIds[0] plays seededIds[1], [2] plays [3], etc.
// Later rounds are placeholder-linked to the preceding round's match IDs.
function buildBracket(seededIds) {
    const n = seededIds.length;
    if (!isPowerOfTwo(n)) {
        throw new Error(`buildBracket requires a power-of-two player count (got ${n})`);
    }

    const rounds = [];
    const totalRounds = Math.log2(n);

    // Round 0 — pair seeds directly
    const round0 = [];
    for (let i = 0; i < n; i += 2) {
        round0.push(_makeMatch(0, i / 2, { playerId: seededIds[i] }, { playerId: seededIds[i + 1] }));
    }
    rounds.push(round0);

    // Rounds 1..totalRounds-1 — each match references two earlier matches
    for (let r = 1; r < totalRounds; r++) {
        const prev = rounds[r - 1];
        const matches = [];
        for (let i = 0; i < prev.length; i += 2) {
            matches.push(_makeMatch(r, i / 2,
                { fromMatchId: prev[i].id },
                { fromMatchId: prev[i + 1].id }));
        }
        rounds.push(matches);
    }

    return { rounds };
}

function _makeMatch(round, indexInRound, slotA, slotB) {
    return {
        id: `R${round}M${indexInRound}`,
        round,
        slotA,
        slotB,
        scoreA: 0,
        scoreB: 0,
        status: _isResolved(slotA) && _isResolved(slotB) ? 'pending' : 'pending',
        winnerPlayerId: null,
    };
}

function _isResolved(slot) {
    return slot && typeof slot.playerId === 'string';
}

// Find a match by id. Linear — brackets are small (<= 31 matches for 32 players).
function findMatch(bracket, matchId) {
    for (const round of bracket.rounds) {
        for (const match of round) {
            if (match.id === matchId) return match;
        }
    }
    return null;
}

// Mark a match complete and propagate the winner into the next round's slot.
// winnerPlayerId must match one of the match's resolved slot playerIds.
// Returns the updated match and the downstream match whose slot was filled
// (or null if this was the final).
function advanceWinner(bracket, matchId, winnerPlayerId) {
    const match = findMatch(bracket, matchId);
    if (!match) throw new Error(`Unknown matchId: ${matchId}`);
    if (match.status === 'complete') throw new Error(`Match ${matchId} already complete`);

    const aId = _isResolved(match.slotA) ? match.slotA.playerId : null;
    const bId = _isResolved(match.slotB) ? match.slotB.playerId : null;
    if (winnerPlayerId !== aId && winnerPlayerId !== bId) {
        throw new Error(`Winner ${winnerPlayerId} is not a slot in match ${matchId}`);
    }

    match.status = 'complete';
    match.winnerPlayerId = winnerPlayerId;

    // Propagate into the next round. Find a match in round+1 whose slotA or
    // slotB references this match by id, and replace it with { playerId }.
    const nextRound = bracket.rounds[match.round + 1];
    if (!nextRound) return { match, nextMatch: null };

    for (const nextMatch of nextRound) {
        if (nextMatch.slotA.fromMatchId === matchId) {
            nextMatch.slotA = { playerId: winnerPlayerId };
            return { match, nextMatch };
        }
        if (nextMatch.slotB.fromMatchId === matchId) {
            nextMatch.slotB = { playerId: winnerPlayerId };
            return { match, nextMatch };
        }
    }
    return { match, nextMatch: null };
}

function isTournamentComplete(bracket) {
    const final = bracket.rounds[bracket.rounds.length - 1];
    return final.length === 1 && final[0].status === 'complete';
}

function getChampion(bracket) {
    if (!isTournamentComplete(bracket)) return null;
    const final = bracket.rounds[bracket.rounds.length - 1][0];
    return final.winnerPlayerId;
}

// Matches whose both slots are resolved (both players known) and which aren't
// yet complete. These are the candidates for "your match is ready" / spectate.
function getActiveMatches(bracket) {
    const active = [];
    for (const round of bracket.rounds) {
        for (const match of round) {
            if (match.status === 'complete') continue;
            if (_isResolved(match.slotA) && _isResolved(match.slotB)) active.push(match);
        }
    }
    return active;
}

// Find the match a given player is currently slotted into (if any not-yet-complete).
function getPlayerCurrentMatch(bracket, playerId) {
    for (const round of bracket.rounds) {
        for (const match of round) {
            if (match.status === 'complete') continue;
            if ((_isResolved(match.slotA) && match.slotA.playerId === playerId) ||
                (_isResolved(match.slotB) && match.slotB.playerId === playerId)) {
                return match;
            }
        }
    }
    return null;
}

module.exports = {
    POWERS_OF_TWO,
    isPowerOfTwo,
    buildBracket,
    findMatch,
    advanceWinner,
    isTournamentComplete,
    getChampion,
    getActiveMatches,
    getPlayerCurrentMatch,
};
