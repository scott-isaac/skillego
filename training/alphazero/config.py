"""AlphaZero configuration for Skillego."""

# ── Board ──────────────────────────────────────────────────────────────────
BOARD_ROWS = 6
BOARD_COLS = 6
NUM_CELLS = BOARD_ROWS * BOARD_COLS  # 36

# ── Pieces ─────────────────────────────────────────────────────────────────
PIECES = [
    {'type': 'mouse',  'power': 1, 'quantity': 6},
    {'type': 'cat',    'power': 2, 'quantity': 4},
    {'type': 'dog',    'power': 3, 'quantity': 4},
    {'type': 'wizard', 'power': 4, 'quantity': 2},
    {'type': 'robot',  'power': 5, 'quantity': 1},
    {'type': 'dragon', 'power': 6, 'quantity': 1},
]

BURN_LEVEL = {p['power']: p['type'] for p in PIECES}
TYPE_TO_IDX = {p['type']: i for i, p in enumerate(PIECES)}
IDX_TO_TYPE = {i: p['type'] for i, p in enumerate(PIECES)}
NUM_PIECE_TYPES = len(PIECES)  # 6

# Directions: N, E, S, W
DIRS = [(-1, 0), (0, 1), (1, 0), (0, -1)]
DIR_TO_IDX = {d: i for i, d in enumerate(DIRS)}

# ── Action Space ───────────────────────────────────────────────────────────
# 27 planes × 36 board cells = 972 total actions
#
# Plane  0-3:  Move/Capture (N, E, S, W) — from cell
# Plane  4:    Uncover — at cell
# Plane  5-8:  Hop (N, E, S, W) — from cell
# Plane  9-12: Push (N, E, S, W) — dragon cell, push direction
# Plane  13:   Engulf — dragon cell
# Plane  14-17: Transform Line (N, E, S, W) — wizard cell, line direction
# Plane  18:   Transform Explode — wizard cell
# Plane  19-22: Snipe (N, E, S, W) — robot cell, fire direction
# Plane  23-26: Pyro (N, E, S, W) — burner cell, spread direction
NUM_ACTION_PLANES = 27
ACTION_SPACE_SIZE = NUM_ACTION_PLANES * NUM_CELLS  # 972

# Plane offsets for each move type
PLANE_MOVE = 0       # +0..3 for direction
PLANE_UNCOVER = 4
PLANE_HOP = 5        # +0..3
PLANE_PUSH = 9       # +0..3
PLANE_ENGULF = 13
PLANE_TRANSFORM_LINE = 14  # +0..3
PLANE_TRANSFORM_EXPLODE = 18
PLANE_SNIPE = 19     # +0..3
PLANE_PYRO = 23      # +0..3

# ── Neural Network ─────────────────────────────────────────────────────────
# Input: 24 channels × 6 × 6
#   0-5:   Own pieces by type (1 if present, including covered own pieces)
#   6-11:  Opponent uncovered pieces by type
#   12:    Own covered pieces (binary)
#   13:    Opponent covered pieces (binary)
#   14:    Empty cells (binary)
#   15:    Own burning pieces (power / 6)
#   16:    Opponent burning pieces (power / 6)
#   17:    Constant 1s (bias)
#   18-23: Ability flags (push, hop, engulf, transform, snipe, pyromania)
NUM_INPUT_CHANNELS = 24
ABILITY_IDS = ['push', 'hop', 'engulf', 'transform', 'snipe', 'pyromania']

NUM_RES_BLOCKS = 4       # Smaller than AlphaZero (game is simpler)
NUM_FILTERS = 64          # Smaller than AlphaZero (6×6 board)

# ── MCTS ───────────────────────────────────────────────────────────────────
MCTS_SIMULATIONS = 50         # Per determinization (CPU-practical; scale up on GPU)
NUM_DETERMINIZATIONS = 2      # Parallel worlds for hidden info (2 for CPU, 8 for GPU)
CPUCT = 1.5                   # PUCT exploration constant
DIRICHLET_ALPHA = 0.3         # Noise for root exploration
DIRICHLET_EPSILON = 0.25      # Noise weight at root
TEMP_THRESHOLD = 15           # Moves with temp=1 before switching to temp→0

# ── Training ───────────────────────────────────────────────────────────────
SELF_PLAY_GAMES = 25          # Games per training iteration (CPU-practical)
TRAINING_ITERATIONS = 200     # Total iterations
BATCH_SIZE = 128
LEARNING_RATE = 0.002
LR_SCHEDULE = {               # Drop LR at these iterations
    50: 0.001,
    100: 0.0005,
    150: 0.0002,
}
WEIGHT_DECAY = 1e-4
REPLAY_BUFFER_SIZE = 50_000
MIN_BUFFER_SIZE = 500
EPOCHS_PER_ITERATION = 10
EVAL_GAMES = 20               # Games to compare new vs old model
WIN_THRESHOLD = 0.55          # Win rate to replace champion
CHECKPOINT_FREQ = 5           # Save model every N iterations

# ── Game ───────────────────────────────────────────────────────────────────
MAX_MOVES_PER_GAME = 300
DEFAULT_ABILITIES = frozenset(['push', 'hop', 'engulf', 'transform', 'snipe', 'pyromania'])
