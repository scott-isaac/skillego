# Neural Network Walkthrough: A 2x2 Example

How does a neural network "figure out" chess-like moves? Let's trace every
matrix multiplication, every weight, every gradient — from board state to
move selection to learning.

We'll use a tiny 2x2 board with 4 pieces to keep the numbers small enough
to follow by hand.

## The Game Setup

```
     col0  col1
row0 [ M1 ] [ C2 ]     M1 = Player 1's Mouse (power 1)
row1 [ c2 ] [ m1 ]     C2 = Player 1's Cat (power 2)
                        c2 = Player 2's Cat (power 2)
                        m1 = Player 2's Mouse (power 1)
```

All pieces are uncovered. It's Player 1's turn.

**Legal moves for Player 1:**
- Mouse at (0,0) → move right to (0,1): CAPTURE P2's cat (mouse can't capture cat — power 1 < 2). **Illegal.**
- Mouse at (0,0) → move down to (1,0): CAPTURE P2's cat (same problem). **Illegal.**
- Cat at (0,1) → move left to (0,0): blocked by own mouse. **Illegal.**
- Cat at (0,1) → move down to (1,1): CAPTURE P2's mouse (power 2 > 1). **Legal!**

Wait — the mouse has a special rule. Mouse captures... no, in this simplified
example there's no dragon. So the only legal move is:

**Cat at (0,1) captures mouse at (1,1).**

But let's make the example more interesting. Let's use this board instead:

```
     col0  col1
row0 [ M1 ] [    ]     M1 = Player 1's Mouse (power 1)
row1 [ c2 ] [ C2 ]     C2 = Player 1's Cat (power 2)
                        c2 = Player 2's Cat (power 2)
                        (0,1) is empty
```

Player 2's mouse was already captured. It's Player 1's turn.

**Legal moves:**
- Mouse (0,0) → right to (0,1): empty cell. **Legal. (Move A)**
- Mouse (0,0) → down to (1,0): P2's cat, power 2 > 1. **Illegal.**
- Cat (1,1) → up to (0,1): empty cell. **Legal. (Move B)**
- Cat (1,1) → left to (1,0): P2's cat, power 2 = 2. **Legal — equal power capture! (Move C)**

So we have 3 legal moves. The network needs to figure out that **Move C** (cat
captures cat) is the best — it eliminates the opponent's last piece and wins.

## Step 1: Encode the Board as Input

We use 4 input channels (simplified from the real 24):

| Channel | Meaning | 2x2 Grid |
|---------|---------|----------|
| Ch 0: My Mouse | 1 where my mouse is | `[[1, 0], [0, 0]]` |
| Ch 1: My Cat | 1 where my cat is | `[[0, 0], [0, 1]]` |
| Ch 2: Opp Cat | 1 where opponent's cat is | `[[0, 0], [1, 0]]` |
| Ch 3: Empty | 1 where cells are empty | `[[0, 1], [0, 0]]` |

Stacked as a tensor of shape (2, 2, 4):

```
Position (0,0): [1, 0, 0, 0]   ← my mouse here
Position (0,1): [0, 0, 0, 1]   ← empty
Position (1,0): [0, 0, 1, 0]   ← opponent's cat
Position (1,1): [0, 1, 0, 0]   ← my cat here
```

## Step 2: Initial Convolution

A convolution slides a small filter (kernel) across the board. We'll use
a 2x2 kernel (instead of the real 3x3) so it covers the whole board in
one position for our tiny example.

With **2 filters** (instead of 64), each filter looks at the 4 input channels
and produces 1 output number per position.

### The weights (randomly initialized before training)

**Filter 0** (shape 2x2x4 — detects "can I capture something?"):
```
kernel_0 = [
  [[-0.1, 0.3, -0.5, 0.0],    ← weights for position (0,0) of the kernel
   [ 0.2, 0.1,  0.4, 0.0]],   ← weights for position (0,1)
  [[ 0.0, 0.2, -0.3, 0.1],    ← weights for position (1,0)
   [-0.1, 0.5,  0.2, 0.0]]    ← weights for position (1,1)
]
```

**Filter 1** (shape 2x2x4 — detects "is my piece safe?"):
```
kernel_1 = [
  [[ 0.3, -0.2, 0.1, 0.2],
   [-0.1,  0.4, 0.0, 0.1]],
  [[ 0.2,  0.0, 0.3, -0.1],
   [ 0.0, -0.3, 0.2, 0.0]]
]
```

### Computing the convolution

Since our board is 2x2 and kernel is 2x2 with "same" padding, we need to
pad the input. But for simplicity, let's compute the output at position (0,0)
for Filter 0 — the kernel overlaps the entire board:

```
output_f0(0,0) = sum over all kernel positions and channels:

  kernel(0,0) dot input(0,0): (-0.1)(1) + (0.3)(0) + (-0.5)(0) + (0.0)(0) = -0.1
+ kernel(0,1) dot input(0,1): (0.2)(0) + (0.1)(0) + (0.4)(0) + (0.0)(1)  =  0.0
+ kernel(1,0) dot input(1,0): (0.0)(0) + (0.2)(0) + (-0.3)(1) + (0.1)(0) = -0.3
+ kernel(1,1) dot input(1,1): (-0.1)(0) + (0.5)(1) + (0.2)(0) + (0.0)(0) =  0.5

Total = -0.1 + 0.0 + (-0.3) + 0.5 = 0.1
```

After doing this for all positions and both filters (with padding), we get
a 2x2x2 output. Let's say the results are:

```
Filter 0 output:        Filter 1 output:
[[ 0.1, -0.2],         [[ 0.3,  0.1],
 [ 0.4,  0.3]]          [-0.1,  0.2]]
```

### BatchNorm + ReLU

**BatchNorm** normalizes the outputs to have mean ~0 and variance ~1:
```
normalized = (value - mean) / sqrt(variance + epsilon)
scaled = gamma * normalized + beta
```
Where gamma and beta are learnable parameters (initially gamma=1, beta=0).

After BatchNorm, let's say we get:
```
Filter 0:               Filter 1:
[[-0.3, -0.8],         [[ 0.6,  0.1],
 [ 0.7,  0.5]]          [-0.5,  0.3]]
```

**ReLU**: `max(0, x)` — just zero out negatives:
```
Filter 0:               Filter 1:
[[ 0.0,  0.0],         [[ 0.6,  0.1],
 [ 0.7,  0.5]]          [ 0.0,  0.3]]
```

This is now a 2x2x2 "feature map" — the network's internal representation
of the board. Filter 0 is "excited" about the bottom row (where captures
are possible). Filter 1 is excited about (0,0) where our mouse is.

## Step 3: Policy Head — "What Move?"

The policy head converts the 2x2x2 feature map into move probabilities.

### 1x1 Convolution (channel mixing)

A 1x1 conv just combines the 2 filter channels at each position:
```
weights = [w0, w1] = [0.4, 0.6]   (for 1 output channel)

position (0,0): 0.4(0.0) + 0.6(0.6) = 0.36
position (0,1): 0.4(0.0) + 0.6(0.1) = 0.06
position (1,0): 0.4(0.7) + 0.6(0.0) = 0.28
position (1,1): 0.4(0.5) + 0.6(0.3) = 0.38
```

### Flatten

Unwrap the 2x2 grid into a flat vector:
```
[0.36, 0.06, 0.28, 0.38]
```

### Dense Layer → Raw Logits

For our simplified action space with 8 possible actions (4 cells x 2 directions):

| Action | Meaning |
|--------|---------|
| 0 | Piece at (0,0) moves right |
| 1 | Piece at (0,0) moves down |
| 2 | Piece at (0,1) moves left |
| 3 | Piece at (0,1) moves down |
| 4 | Piece at (1,0) moves up |
| 5 | Piece at (1,0) moves right |
| 6 | Piece at (1,1) moves up |
| 7 | Piece at (1,1) moves left |

The dense layer multiplies the 4-number vector by a 4x8 weight matrix:

```
W_policy = [
  [ 0.1, -0.2,  0.0,  0.1, -0.1,  0.3,  0.2, -0.1],   ← from (0,0)
  [-0.1,  0.0,  0.2, -0.1,  0.1,  0.0,  0.1,  0.2],   ← from (0,1)
  [ 0.0,  0.1, -0.1,  0.2,  0.0, -0.2,  0.3,  0.1],   ← from (1,0)
  [ 0.2,  0.0,  0.1,  0.0,  0.3, -0.1, -0.2,  0.4],   ← from (1,1)
]

b_policy = [0, 0, 0, 0, 0, 0, 0, 0]   (bias, initially zero)

logits = [0.36, 0.06, 0.28, 0.38] @ W_policy + b_policy

Action 0: 0.36(0.1) + 0.06(-0.1) + 0.28(0.0) + 0.38(0.2)  = 0.036 - 0.006 + 0 + 0.076 = 0.106
Action 1: 0.36(-0.2) + 0.06(0.0) + 0.28(0.1) + 0.38(0.0)  = -0.072 + 0 + 0.028 + 0    = -0.044
Action 2: 0.36(0.0) + 0.06(0.2) + 0.28(-0.1) + 0.38(0.1)  = 0 + 0.012 - 0.028 + 0.038 = 0.022
Action 3: 0.36(0.1) + 0.06(-0.1) + 0.28(0.2) + 0.38(0.0)  = 0.036 - 0.006 + 0.056 + 0 = 0.086
Action 4: 0.36(-0.1) + 0.06(0.1) + 0.28(0.0) + 0.38(0.3)  = -0.036 + 0.006 + 0 + 0.114 = 0.084
Action 5: 0.36(0.3) + 0.06(0.0) + 0.28(-0.2) + 0.38(-0.1) = 0.108 + 0 - 0.056 - 0.038 = 0.014
Action 6: 0.36(0.2) + 0.06(0.1) + 0.28(0.3) + 0.38(-0.2)  = 0.072 + 0.006 + 0.084 - 0.076 = 0.086
Action 7: 0.36(-0.1) + 0.06(0.2) + 0.28(0.1) + 0.38(0.4)  = -0.036 + 0.012 + 0.028 + 0.152 = 0.156
```

Raw logits: `[0.106, -0.044, 0.022, 0.086, 0.084, 0.014, 0.086, 0.156]`

### Mask Illegal Moves

Our legal moves are:
- Action 0: Mouse (0,0) right → empty (0,1). **Legal.**
- Action 6: Cat (1,1) up → empty (0,1). **Legal.**
- Action 7: Cat (1,1) left → captures opponent cat (1,0). **Legal.**

All others are illegal → set to -infinity:

```
masked = [-inf, -inf, -inf, -inf, -inf, -inf, 0.086, 0.156]
          (only actions 0, 6, 7 survive)
```

Wait — action 0 is also legal. Let me fix:
```
masked = [0.106, -inf, -inf, -inf, -inf, -inf, 0.086, 0.156]
```

### Softmax → Probabilities

```
exp(0.106) = 1.112
exp(0.086) = 1.090
exp(0.156) = 1.169
sum = 3.371

P(action 0) = 1.112 / 3.371 = 0.330   (33.0%)  Mouse moves right
P(action 6) = 1.090 / 3.371 = 0.323   (32.3%)  Cat moves up
P(action 7) = 1.169 / 3.371 = 0.347   (34.7%)  Cat captures cat  ← highest!
```

The untrained network slightly prefers **Move C** (cat captures cat) — but
it's almost random (33/32/35 split). Training will sharpen this dramatically.

## Step 4: Value Head — "Who's Winning?"

Same 2x2x2 feature map, different processing path:

### 1x1 Conv (down to 1 channel)
```
weights = [0.3, -0.5]

position (0,0): 0.3(0.0) + (-0.5)(0.6) = -0.30
position (0,1): 0.3(0.0) + (-0.5)(0.1) = -0.05
position (1,0): 0.3(0.7) + (-0.5)(0.0) =  0.21
position (1,1): 0.3(0.5) + (-0.5)(0.3) =  0.00
```

### Flatten
```
[-0.30, -0.05, 0.21, 0.00]
```

### Dense → 2 hidden units (simplified from 128)
```
W_hidden = [
  [ 0.4, -0.3],
  [ 0.1,  0.5],
  [-0.2,  0.3],
  [ 0.6, -0.1],
]
b_hidden = [0, 0]

hidden = [-0.30(0.4) + -0.05(0.1) + 0.21(-0.2) + 0.00(0.6),
          -0.30(-0.3) + -0.05(0.5) + 0.21(0.3) + 0.00(-0.1)]
       = [-0.12 - 0.005 - 0.042 + 0,   0.09 - 0.025 + 0.063 + 0]
       = [-0.167,  0.128]

ReLU: [0.0, 0.128]
```

### Dense → 1 output with tanh
```
W_out = [0.7, -0.4]
b_out = [0]

raw = 0.0(0.7) + 0.128(-0.4) + 0 = -0.0512
value = tanh(-0.0512) = -0.051
```

**The untrained network thinks this position is very slightly bad for
Player 1 (value = -0.051).** This is wrong — Player 1 has 2 pieces vs 1 and
can capture immediately. Training will fix this.

## Step 5: MCTS Uses Both Outputs

MCTS now runs 50 simulations using these outputs:

```
Root position (Player 1 to move)
├── Move A: Mouse right  (prior = 0.330, value = ???)
├── Move B: Cat up        (prior = 0.323, value = ???)
└── Move C: Cat captures  (prior = 0.347, value = ???)
```

Simulation 1: MCTS picks Move C (highest prior). After capturing, the
resulting position is evaluated by the NN: opponent has 0 pieces → value = +1.0.

Simulation 2: MCTS picks Move A (next highest unvisited prior). After moving
mouse, the position still has the opponent's cat → value = maybe +0.3.

After 50 simulations, Move C has been visited most and has value +1.0:

```
Move A: visits = 8,  avg value = +0.2
Move B: visits = 5,  avg value = +0.1
Move C: visits = 37, avg value = +0.95  ← MCTS strongly prefers this
```

**MCTS visit distribution (training target for policy):**
```
pi = [8/50, 0, 0, 0, 0, 0, 5/50, 37/50]
   = [0.16, 0, 0, 0, 0, 0, 0.10, 0.74]
```

**Game outcome: Player 1 wins → z = +1.0**

## Step 6: Training — The Learning Step

We now have one training sample:
- **Input**: the board state tensor
- **Policy target** (pi): `[0.16, 0, 0, 0, 0, 0, 0.10, 0.74]`
- **Value target** (z): `+1.0`

### Policy Loss (Cross-Entropy)

How far off was the NN's policy from what MCTS found?

```
NN output (after softmax): [0.330, 0, 0, 0, 0, 0, 0.323, 0.347]
MCTS target:               [0.160, 0, 0, 0, 0, 0, 0.100, 0.740]

L_policy = -sum(target[i] * log(output[i]))
         = -(0.16 * log(0.330) + 0.10 * log(0.323) + 0.74 * log(0.347))
         = -(0.16 * (-1.109) + 0.10 * (-1.130) + 0.74 * (-1.058))
         = -(−0.177 − 0.113 − 0.783)
         = 1.073
```

This is high — the NN gave ~33% to the winning move, but MCTS says it should
be ~74%. The loss function captures this discrepancy.

### Value Loss (MSE)

```
NN output: -0.051
Target:    +1.0

L_value = (-0.051 - 1.0)^2 = (-1.051)^2 = 1.105
```

Also high — the NN thought the position was slightly bad, but it's actually winning.

### Total Loss

```
L = L_policy + L_value = 1.073 + 1.105 = 2.178
```

### Backpropagation: Computing Gradients

The key question: **which weights should change, and by how much?**

The gradient tells us: for each weight, if I increase it slightly, how much
does the loss change? We want to move weights in the direction that
**decreases** the loss.

**For the value head output weight** (W_out = [0.7, -0.4]):

```
d(loss)/d(W_out[1]) = d(loss)/d(value) * d(value)/d(raw) * d(raw)/d(W_out[1])

d(loss)/d(value) = 2 * (value - target) = 2 * (-0.051 - 1.0) = -2.102
d(value)/d(raw)  = 1 - tanh^2(raw) = 1 - (-0.051)^2 = 0.997
d(raw)/d(W_out[1]) = hidden[1] = 0.128

gradient = -2.102 * 0.997 * 0.128 = -0.268
```

**Weight update** (with learning rate 0.002):
```
W_out[1] -= learning_rate * gradient
W_out[1] -= 0.002 * (-0.268)
W_out[1] = -0.4 + 0.000536 = -0.3995
```

A tiny nudge. The weight moved from -0.4 to -0.3995 — making the value
output slightly more positive for positions with this pattern.

**For the policy dense weight** W_policy[3][7] (maps position (1,1) features
to action 7 — cat captures cat):

```
d(loss)/d(logit[7]) = output[7] - target[7] = 0.347 - 0.740 = -0.393
d(logit[7])/d(W[3][7]) = flat_features[3] = 0.38

gradient = -0.393 * 0.38 = -0.149

W_policy[3][7] -= 0.002 * (-0.149)
W_policy[3][7] = 0.4 + 0.000298 = 0.4003
```

The weight connecting position (1,1) features to the "cat captures" action
increased slightly — making the network more likely to recommend this capture
in similar positions.

### The Chain Rule Through Convolutions

The gradients propagate ALL the way back through the network:

```
Loss
  ↑ gradient flows backward
Policy Dense weights    ← adjusted to prefer capture moves
  ↑
Policy 1x1 Conv weights ← adjusted to highlight "capturable" features
  ↑
ResBlock Conv weights    ← adjusted to detect "adjacent enemy" patterns
  ↑
Initial Conv weights     ← adjusted to detect "piece at position" patterns
```

Every weight in the network gets a gradient and a tiny update. After thousands
of training samples (from thousands of self-play games), the weights converge
to values that make the network genuinely understand the game.

## Step 7: After Training — What Changed?

After 2,500 games of self-play and training, the weights have shifted so that:

**The convolution filters** now reliably detect:
- "Enemy piece adjacent to my stronger piece" → high activation
- "My dragon near opponent's mouse" → danger signal
- "My mouse near opponent's dragon" → opportunity signal

**The policy head weights** now produce:
- High logits for capture moves (especially favorable trades)
- High logits for moves toward enemy pieces
- Low logits for moves away from the action
- Very high logits for mouse-captures-dragon

**The value head** now outputs:
- +0.8 or higher when material advantage is clear
- -0.8 or lower when losing
- Nuanced values for complex positions (trapped pieces, burning dynamics)

For our example position, after training:

```
Policy output: [0.02, 0, 0, 0, 0, 0, 0.03, 0.95]
                                              ↑
                              Cat captures cat: 95% probability

Value output: +0.92  (correctly identifies winning position)
```

The network went from "33% chance of the right move" to "95% chance" — not
because anyone programmed "captures are good," but because it played 2,500
games against itself and learned from the outcomes.

## Summary: The Full Pipeline

```
Board State (what the player sees)
     |
     v
[Encode as tensor] ────────── 2x2 grid x 4 channels = 16 numbers
     |
     v
[Convolution] ─────────────── Slide filters across the board
     |                         detecting spatial patterns
     v
[BatchNorm + ReLU] ────────── Normalize and add nonlinearity
     |
     +──────────────────+
     |                  |
     v                  v
[Policy Head]      [Value Head]
     |                  |
     v                  v
972 move probs    1 position score
     |                  |
     +──────────────────+
     |
     v
[MCTS combines them]
     |
     v
Best move
     |
     v
[Play the game, record outcome]
     |
     v
[Compute loss: how wrong were we?]
     |
     v
[Backprop: compute gradients for every weight]
     |
     v
[Update weights: nudge each one to reduce loss]
     |
     v
[Repeat 2,500 times]
     |
     v
Network that genuinely understands the game
```
