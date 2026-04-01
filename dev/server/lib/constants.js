'use strict';

const BOARD_CONFIG = {
    2: { rows: 6, cols: 6 },
    4: { rows: 9, cols: 8 },
};

const PIECES = [
    { type: 'mouse',  power: 1, quantity: 6 },
    { type: 'cat',    power: 2, quantity: 4 },
    { type: 'dog',    power: 3, quantity: 4 },
    { type: 'wizard', power: 4, quantity: 2 },
    { type: 'robot',  power: 5, quantity: 1 },
    { type: 'dragon', power: 6, quantity: 1 },
];

// Power → type lookup for burning piece burn-down
const BURN_LEVEL = {};
PIECES.forEach(p => { BURN_LEVEL[p.power] = { type: p.type }; });

const CPU_DIFFICULTY_PARAMS = {
    easy:   { depth: 1, noise: 35 },
    medium: { depth: 2, noise: 15 },
    hard:   { depth: 3, noise: 0  },
    expert: { depth: null, noise: 0 },
};

const ALL_ABILITY_IDS = ['push', 'engulf', 'hop', 'transform', 'snipe', 'pyromania'];

module.exports = { BOARD_CONFIG, PIECES, BURN_LEVEL, CPU_DIFFICULTY_PARAMS, ALL_ABILITY_IDS };
