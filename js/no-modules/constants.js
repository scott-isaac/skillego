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

// Abilities available per piece type (list of ability IDs).
const PIECE_ABILITIES = {
    dragon: ['push'],
    mouse:  ['hop'],
    wizard: ['transform'],
};

const PLAYER_COLORS = {
    1: '#ff9999', // Softer red
    2: '#9999ff'  // Softer blue
};
