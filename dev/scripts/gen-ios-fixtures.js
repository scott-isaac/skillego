#!/usr/bin/env node
'use strict';

// Generates {function, input, args, output} fixtures for the iOS JSContext engine
// tests by running the exact same rules.js file the app bundles through a curated
// set of board states, using Node's `vm` module as a stand-in for a bare, DOM-less
// JS context (the same "no browser globals" property that makes rules.js safe to
// load into JSContext also makes it loadable here).
//
// Each fixture records which pure rules.js function was called, the board state
// and arguments it was called with, and the exact output — the Swift-side test
// (ios/SkillegoTests/JSEngineTests.swift) replays the same call through the real
// bundled JSContext (via bridge.js's ios_test_* helpers) and asserts equality.
//
// Run: node scripts/gen-ios-fixtures.js
// Output: ios/SkillegoTests/Fixtures/*.json

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js', 'no-modules');
const OUT_DIR = path.join(__dirname, '..', 'ios', 'SkillegoTests', 'Fixtures');
const ENGINE_FILES = ['constants.js', 'state.js', 'rules.js'];

function loadEngine() {
    const sandbox = {};
    vm.createContext(sandbox);
    for (const file of ENGINE_FILES) {
        const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
        vm.runInContext(code, sandbox, { filename: file });
    }
    return sandbox;
}

function emptyBoard(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function coveredGrid(rows, cols, value) {
    return Array.from({ length: rows }, () => Array(cols).fill(value));
}

// `pieces`: [{ r, c, type, power, player, burning?, covered? }]
function buildState(sandbox, rows, cols, pieces, pushBlocked) {
    // BOARD_ROWS/BOARD_COLS are `let` bindings in constants.js's top-level
    // script scope, not properties of the sandbox object — assigning
    // `sandbox.BOARD_ROWS = rows` from out here would silently create an
    // unrelated stray property instead of updating the binding `inBounds()`
    // actually reads. Reassign by running code *inside* the context instead.
    vm.runInContext(`BOARD_ROWS = ${rows}; BOARD_COLS = ${cols};`, sandbox);
    const board = emptyBoard(rows, cols);
    const covered = coveredGrid(rows, cols, false);
    for (const p of pieces) {
        board[p.r][p.c] = { type: p.type, power: p.power, player: p.player, burning: !!p.burning };
        if (p.covered) covered[p.r][p.c] = true;
    }
    return { board, covered, pushBlocked: pushBlocked || [] };
}

// `moveArgs` (function-specific):
//   getValidMoves/getPushMoves/getHopMoves/getEngulfMoves/getTransformMoves/
//   getSnipeMoves/getPyroMoves -> { r, c }
//   applyMoveToState -> { move: {...} }
function scenario(name, sandbox, fn, { rows = 6, cols = 6, pieces, pushBlocked, abilities = [] }, moveArgs) {
    const state = buildState(sandbox, rows, cols, pieces, pushBlocked);
    const enabledAbilities = new Set(abilities);
    const input = { rows, cols, pieces, pushBlocked: pushBlocked || [], abilities };

    let output;
    if (fn === 'applyMoveToState') {
        output = sandbox.applyMoveToState(state, moveArgs.move);
    } else {
        output = sandbox[fn](state, moveArgs.r, moveArgs.c, enabledAbilities);
    }
    return { name, function: fn, input, args: moveArgs, output };
}

function main() {
    const sandbox = loadEngine();
    const fixtures = [];

    // ── getValidMoves: plain move + capture + mouse-beats-dragon exception ──
    fixtures.push(scenario('validMoves_plainMoveAndCapture', sandbox, 'getValidMoves', {
        pieces: [
            { r: 2, c: 2, type: 'dog', power: 3, player: 1 },
            { r: 2, c: 3, type: 'cat', power: 2, player: 2 },
        ],
    }, { r: 2, c: 2 }));

    fixtures.push(scenario('validMoves_mouseBeatsDragon', sandbox, 'getValidMoves', {
        pieces: [
            { r: 3, c: 3, type: 'mouse', power: 1, player: 1 },
            { r: 3, c: 4, type: 'dragon', power: 6, player: 2 },
        ],
    }, { r: 3, c: 3 }));

    fixtures.push(scenario('validMoves_dragonCannotCaptureMouse', sandbox, 'getValidMoves', {
        pieces: [
            { r: 3, c: 3, type: 'dragon', power: 6, player: 1 },
            { r: 3, c: 4, type: 'mouse', power: 1, player: 2 },
        ],
    }, { r: 3, c: 3 }));

    fixtures.push(scenario('validMoves_coveredPieceHasNoMoves', sandbox, 'getValidMoves', {
        pieces: [{ r: 1, c: 1, type: 'dog', power: 3, player: 1, covered: true }],
    }, { r: 1, c: 1 }));

    // ── Ability move generation ──
    fixtures.push(scenario('pushMoves_dragonPushesEnemy', sandbox, 'getPushMoves', {
        pieces: [
            { r: 2, c: 2, type: 'dragon', power: 6, player: 1 },
            { r: 2, c: 3, type: 'mouse', power: 1, player: 2 },
        ],
        abilities: ['push'],
    }, { r: 2, c: 2 }));

    fixtures.push(scenario('hopMoves_mouseHopsOverPiece', sandbox, 'getHopMoves', {
        pieces: [
            { r: 2, c: 2, type: 'mouse', power: 1, player: 1 },
            { r: 2, c: 3, type: 'cat', power: 2, player: 1 },
        ],
        abilities: ['hop'],
    }, { r: 2, c: 2 }));

    fixtures.push(scenario('transformMoves_wizardLineAndExplosion', sandbox, 'getTransformMoves', {
        pieces: [{ r: 3, c: 3, type: 'wizard', power: 4, player: 1 }],
        abilities: ['transform'],
    }, { r: 3, c: 3 }));

    fixtures.push(scenario('snipeMoves_robotSnipesWithCatSpotter', sandbox, 'getSnipeMoves', {
        pieces: [
            { r: 0, c: 0, type: 'robot', power: 5, player: 1 },
            { r: 0, c: 3, type: 'mouse', power: 1, player: 2 },
            { r: 1, c: 3, type: 'cat', power: 2, player: 1 },
        ],
        abilities: ['snipe'],
    }, { r: 0, c: 0 }));

    fixtures.push(scenario('pyroMoves_burningPieceSpreadsFire', sandbox, 'getPyroMoves', {
        pieces: [
            { r: 2, c: 2, type: 'dragon', power: 4, player: 1, burning: true },
            { r: 2, c: 3, type: 'cat', power: 2, player: 2 },
        ],
        abilities: ['pyromania'],
    }, { r: 2, c: 2 }));

    // ── applyMoveToState ──
    fixtures.push(scenario('applyMove_captureRemovesDefender', sandbox, 'applyMoveToState', {
        pieces: [
            { r: 2, c: 2, type: 'dog', power: 3, player: 1 },
            { r: 2, c: 3, type: 'cat', power: 2, player: 2 },
        ],
    }, { move: { type: 'capture', fromR: 2, fromC: 2, toR: 2, toC: 3 } }));

    fixtures.push(scenario('applyMove_uncoverRevealsPiece', sandbox, 'applyMoveToState', {
        pieces: [{ r: 1, c: 1, type: 'dog', power: 3, player: 1, covered: true }],
    }, { move: { type: 'uncover', r: 1, c: 1 } }));

    fixtures.push(scenario('applyMove_pushMovesEnemyAndBlocksSquare', sandbox, 'applyMoveToState', {
        pieces: [
            { r: 2, c: 2, type: 'dragon', power: 6, player: 1 },
            { r: 2, c: 3, type: 'mouse', power: 1, player: 2 },
        ],
    }, { move: { type: 'push', drR: 2, drC: 2, enemyR: 2, enemyC: 3, destR: 2, destC: 4 } }));

    fixtures.push(scenario('applyMove_burningPieceBurnsDownOnMove', sandbox, 'applyMoveToState', {
        pieces: [{ r: 2, c: 2, type: 'dragon', power: 6, player: 1, burning: true }],
    }, { move: { type: 'move', fromR: 2, fromC: 2, toR: 2, toC: 3 } }));

    fixtures.push(scenario('applyMove_transformExplosionSpawnsFourMice', sandbox, 'applyMoveToState', {
        pieces: [{ r: 3, c: 3, type: 'wizard', power: 4, player: 1 }],
    }, {
        move: {
            type: 'transform', wizR: 3, wizC: 3, isExplosion: true,
            cells: [{ r: 2, c: 3 }, { r: 4, c: 3 }, { r: 3, c: 2 }, { r: 3, c: 4 }],
        },
    }));

    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const fixture of fixtures) {
        const file = path.join(OUT_DIR, `${fixture.name}.json`);
        fs.writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
    }
    console.log(`Wrote ${fixtures.length} fixtures to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main();
