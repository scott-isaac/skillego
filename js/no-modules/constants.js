// constants.js - Game constants

const BOARD_SIZE = 6;
const PIECES = [
    { type: 'mouse', power: 1, quantity: 6, emoji: '🐭' },
    { type: 'cat', power: 2, quantity: 4, emoji: '😸' },
    { type: 'dog', power: 3, quantity: 4, emoji: '🐶' },
    { type: 'wizard', power: 4, quantity: 2, emoji: '🧙‍♂️' },
    { type: 'robot', power: 5, quantity: 1, emoji: '🤖' },
    { type: 'dragon', power: 6, quantity: 1, emoji: '🐉' },
];

// Power → type+emoji lookup for burning piece burn-down
const BURN_LEVEL = {};
PIECES.forEach(p => { BURN_LEVEL[p.power] = { type: p.type, emoji: p.emoji }; });

// Abilities available per piece type (list of ability IDs).
const PIECE_ABILITIES = {
    dragon: ['push', 'engulf'],
    mouse:  ['hop'],
    wizard: ['transform'],
    robot:  ['snipe'],
};

// Structured ability definitions — used for the setup toggles and How to Play
const ALL_ABILITIES = [
    { id: 'push',    piece: 'dragon', emoji: '🐉', name: 'Dragon Push',
      description: 'Instead of moving, the Dragon pushes an adjacent enemy one square away (if the space behind it is clear).' },
    { id: 'engulf',  piece: 'dragon', emoji: '🐉', name: 'Dragon Enflame',
      description: 'The Dragon bursts into flames. While burning: immune to Mice, can kill Mice. But every move costs 1 power — cycling down through the piece hierarchy until it burns out at 0.' },
    { id: 'hop',     piece: 'mouse',  emoji: '🐭', name: 'Mouse Hop',
      description: 'A Mouse can jump over any adjacent piece to the empty square beyond it.' },
    { id: 'transform', piece: 'wizard', emoji: '🧙‍♂️', name: 'Wizard Transform',
      description: 'A Wizard permanently becomes 4 Mice — choose a line direction (Wizard stays + 3 extend) or a 4-way explosion (Wizard vanishes, 4 Mice surround the position).' },
    { id: 'snipe', piece: 'robot', emoji: '🤖', name: 'Robot Wants Kitty',
      description: 'If a Robot sees a friendly Kitty in danger from another piece, it can race to help — capturing any enemy along a clear orthogonal line if a friendly (non-burning) Cat is adjacent to the target. The Robot moves to the target\'s square. A burning Robot cannot snipe.' },
    { id: 'pyromania', piece: null, emoji: '🔥', name: 'Pyromania',
      description: 'Any burning piece can spread fire to an adjacent enemy, setting it ablaze (and revealing it if covered). Costs the spreader 1 power level — even down to burnout.' },
];

const PLAYER_COLORS = {
    1: '#ff9999', // Softer red
    2: '#9999ff'  // Softer blue
};
