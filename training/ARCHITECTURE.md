# SkillZero Neural Network Architecture

## Overview

The SkillZero neural network takes a board position as input and produces two outputs:
- **Policy**: which moves look promising (probability distribution over all legal actions)
- **Value**: who's winning from this position (single number, -1 to +1)

The network runs entirely in the browser via TensorFlow.js. The Python training
pipeline generates the weights; the JS code just does inference (matrix math).

## Input: What the Network Sees

**24 channels on a 6x6 board = 864 numbers**

Think of it as 24 transparent overlays stacked on the board, each answering
a different question about the position:

| Channels | What it encodes |
|----------|----------------|
| 0-5 | My pieces by type (mouse, cat, dog, wizard, robot, dragon) |
| 6-11 | Opponent's revealed pieces by type |
| 12 | My face-down pieces (I know what they are) |
| 13 | Opponent's face-down pieces (I know WHERE but not WHAT) |
| 14 | Empty cells |
| 15 | My burning pieces (value = current power / 6) |
| 16 | Opponent's burning pieces |
| 17 | Constant 1s (bias term) |
| 18-23 | Ability flags (push, hop, engulf, transform, snipe, pyromania) |

The network sees exactly what a human player would see. Own covered pieces are
visible (you placed them), opponent's covered pieces are just "something is here."
No cheating.

Each channel is a 6x6 grid of floats. A 1.0 means "yes, this piece/condition is
here." A 0.0 means "no." Burning pieces use fractional values (power/6) to encode
how much burn is left.

## Processing: The Residual Tower

The input passes through an initial convolution followed by 4 residual blocks:

```
Input (6 x 6 x 24)
  |
  v
[Conv2D 3x3, 64 filters] --> [BatchNorm] --> [ReLU]
  |
  v
  +--- ResBlock 0 ------+
  |    Conv 3x3, 64      |
  |    BatchNorm          |
  |    ReLU               |  <- "scan for local patterns"
  |    Conv 3x3, 64      |
  |    BatchNorm          |
  +-- + skip connection --+
  |    ReLU
  v
  +--- ResBlock 1 ------+
  |         ...          |  <- "combine patterns"
  +-- + skip connection --+
  |    ReLU
  v
  +--- ResBlock 2 ------+
  |         ...          |  <- "reason about relationships"
  +-- + skip connection --+
  |    ReLU
  v
  +--- ResBlock 3 ------+
  |         ...          |  <- "evaluate strategic implications"
  +-- + skip connection --+
  |    ReLU
  v
Rich board representation (6 x 6 x 64)
```

### What each component does

**Conv2D 3x3**: A 3x3 sliding window that looks at each cell and its 8 neighbors.
Each filter learns to detect a different spatial pattern. 64 filters = 64 different
things to look for at every board position.

**BatchNormalization**: Normalizes the values across each filter so the network
trains stably. Without this, deep networks often fail to learn because values
grow or shrink uncontrollably through layers.

**ReLU** (Rectified Linear Unit): `output = max(0, input)`. The simplest nonlinear
activation function. Without nonlinearity, stacking multiple convolutions would
just be equivalent to one big convolution. ReLU lets the network learn complex,
non-obvious patterns.

**Skip connection** (the + in the diagram): Adds the block's input directly to its
output. This is the key innovation from ResNets (2015). Benefits:
- Gradients flow easily through the network during training (no vanishing gradients)
- Each block only needs to learn the "residual" — what to ADD to the current
  representation, not rebuild it from scratch
- Makes deeper networks trainable where they'd otherwise plateau

### What the network learns at each depth

This is approximate — the network organizes its own internal representations,
but generally:

- **Early layers**: Local patterns. "A mouse is adjacent to a dragon." "This cell
  is empty and surrounded by enemies." "This piece is uncovered."
- **Middle layers**: Tactical relationships. "This dragon is trapped — all escape
  squares are threatened." "The wizard could transform to create a mouse threat."
- **Later layers**: Strategic assessment. "Player 1 has a material advantage but
  their dragon is in danger." "The robot has a clear snipe line if the cat moves."

## Output: Two Heads

The 6x6x64 representation feeds into two separate output heads:

### Policy Head (972 outputs)

```
6x6x64
  |
  v
[Conv2D 1x1, 32 filters] --> [BatchNorm] --> [ReLU]
  |
  v
[Flatten] --> 1,152 numbers
  |
  v
[Dense layer] --> 972 raw logits
  |
  v
[Mask illegal moves] --> [Softmax] --> 972 probabilities
```

Each of the 972 slots corresponds to a specific action:

| Action planes | Move type | Count |
|---------------|-----------|-------|
| 0-3 | Move/Capture (N, E, S, W) | 144 |
| 4 | Uncover | 36 |
| 5-8 | Mouse Hop (N, E, S, W) | 144 |
| 9-12 | Dragon Push (N, E, S, W) | 144 |
| 13 | Dragon Engulf | 36 |
| 14-17 | Wizard Transform Line (N, E, S, W) | 144 |
| 18 | Wizard Transform Explode | 36 |
| 19-22 | Robot Snipe (N, E, S, W) | 144 |
| 23-26 | Pyro Spread (N, E, S, W) | 144 |
| **Total** | | **972** |

Action index = `plane * 36 + row * 6 + col`, where (row, col) is the piece's position.

**Masking**: Most of the 972 actions are illegal in any given position (you can't
hop with a dragon, can't snipe without a cat spotter, etc.). Before softmax, all
illegal actions are set to negative infinity, so their probability becomes 0.

**Softmax**: Converts raw logits to probabilities that sum to 1.0:

```
P(action_i) = exp(logit_i) / sum(exp(logit_j) for all legal j)
```

The MCTS uses these probabilities as "prior beliefs" about which moves are worth
exploring. High-probability moves get searched first and deeper.

### Value Head (1 output)

```
6x6x64
  |
  v
[Conv2D 1x1, 1 filter] --> [BatchNorm] --> [ReLU]
  |
  v
[Flatten] --> 36 numbers
  |
  v
[Dense 128, ReLU] --> 128 numbers
  |
  v
[Dense 1, tanh] --> single value in [-1, +1]
```

**tanh**: Squashes the output to the range [-1, +1]:

```
tanh(x) = (exp(x) - exp(-x)) / (exp(x) + exp(-x))
```

- **+1.0**: "I'm definitely winning"
- **0.0**: "Even position"
- **-1.0**: "I'm definitely losing"

This replaces the hand-crafted evaluation function used by minimax. Instead of
us programming "dragon = 60 points, mouse near dragon = 45 points..." the network
learned its own evaluation from 2,500 games of self-play.

## How the Two Heads Work Together (MCTS)

The policy and value heads are combined via Monte Carlo Tree Search:

```
Current position
  |
  v
NN predicts: policy (which moves?) + value (who's winning?)
  |
  v
MCTS builds a search tree:
  - Uses POLICY to decide which moves to explore first
  - Uses VALUE to evaluate positions it hasn't fully searched
  - Runs 50-200 simulations, each walking down the tree
  |
  v
Pick the most-visited move (the one MCTS is most confident about)
```

**PUCT selection** (how MCTS picks which branch to explore):

```
score(move) = Q(move) + c * P(move) * sqrt(N_parent) / (1 + N_move)
```

Where:
- `Q(move)` = average value from previous visits (exploitation)
- `P(move)` = NN's policy prior for this move (guidance)
- `N_parent` = total visits to the parent node
- `N_move` = visits to this specific move
- `c` = exploration constant (1.5) — balances exploration vs exploitation

Early in the search, the `P(move) * sqrt(N_parent) / (1 + N_move)` term dominates,
so moves the NN thinks are good get explored first. As the search deepens,
the `Q(move)` term takes over, favoring moves that have proven good through search.

## Hidden Information: Determinization

Skillego has hidden pieces (face-down). The NN handles this through
**Information Set MCTS**:

1. The NN sees the board from the current player's perspective (own hidden
   pieces known, opponent's hidden pieces are mystery cells)
2. Before searching, randomly assign identities to opponent's hidden pieces
   consistent with what's been revealed (this is called "determinization")
3. Run MCTS on this concrete world
4. Repeat with different random assignments (2-4 worlds)
5. Aggregate results across all worlds

This handles the uncertainty naturally. If a move is good regardless of what
the opponent has hidden, it'll score well across all determinizations.

## Training: How the Weights Are Learned

The 1,438,865 trainable parameters are learned through self-play:

```
1. Play a game using current NN + MCTS
   - At each move, record: (board_state, MCTS_visit_counts, who_won)

2. Train the NN:
   - Policy target: "MCTS visited these moves most" (visit distribution)
   - Value target: "this position led to a win (+1) or loss (-1)"
   - Policy loss: cross-entropy between NN output and MCTS visits
   - Value loss: MSE between NN output and game outcome

3. Repeat. Better NN -> better MCTS -> better training data -> better NN.
```

### Loss functions

**Policy loss** (cross-entropy): How far off are the NN's move probabilities from
what MCTS actually searched?

```
L_policy = -sum(pi_mcts[i] * log(pi_nn[i]))
```

Where `pi_mcts` is the MCTS visit distribution (target) and `pi_nn` is the NN's
output (prediction). Lower = NN agrees with MCTS more.

**Value loss** (mean squared error): How far off is the NN's position evaluation
from the actual game outcome?

```
L_value = (v_nn - z)^2
```

Where `v_nn` is the NN's value prediction and `z` is +1 (win) or -1 (loss).

**Total loss**:

```
L = L_policy + L_value + c * ||weights||^2
```

The last term is L2 regularization — penalizes large weights to prevent overfitting.

## Model Size

| Component | Parameters |
|-----------|-----------|
| Initial conv (3x3x24x64) | 13,824 |
| 4 residual blocks (3x3x64x64 x 2 each) | 295,936 |
| Batch norm layers (gamma + beta + running stats) | ~1,200 |
| Policy head (conv + dense) | 1,122,764 |
| Value head (conv + dense) | 4,865 |
| **Total** | **1,438,865** |

Saved model size: ~5.6 MB (float32 weights).

For comparison: AlphaZero for chess used 40 residual blocks, 256 filters, and
~44 million parameters. Our network is ~30x smaller because the game is simpler
(6x6 board, 6 piece types, vs 8x8 board with complex piece movement).
