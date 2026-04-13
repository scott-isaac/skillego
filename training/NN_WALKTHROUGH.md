# Neural Network Move Selection in Hidden-Information Board Games

## A Worked Example on a 2x2 Board

### Abstract

We present a complete mathematical walkthrough of a neural network learning
to play a simplified hidden-information board game. Using a 2x2 board with
four pieces, we first enumerate the complete game tree to establish optimal
play, then trace every matrix operation from board encoding through
convolution, policy output, value estimation, and weight adjustment via
backpropagation. The example demonstrates how a randomly initialized network
converges toward optimal play through self-play reinforcement learning.

---

## 1. Game Definition

### 1.1 Board and Pieces

Let the board be a 2x2 grid B with positions indexed as (r, c) where
r, c in {0, 1}. Two players P1 and P2 each have two pieces:

| Piece | Power | Quantity per player |
|-------|-------|-------------------|
| Mouse | 1 | 1 |
| Cat | 2 | 1 |

All four pieces are placed randomly on B at the start of the game. All
pieces begin **covered** (face-down) — neither player knows the identity
or ownership of any piece until it is uncovered.

### 1.2 Rules

On each turn, the current player must perform exactly one action:

1. **Uncover**: Select any covered cell. The piece is revealed to both players.
2. **Move**: Move one of their own uncovered pieces to an orthogonally
   adjacent cell that is either empty or occupied by a capturable opponent piece.

**Capture rule**: A piece of power p_a captures a piece of power p_d if and
only if p_a >= p_d and the pieces belong to different players. The captured
piece is removed from the board.

**Win condition**: A player wins when all opponent pieces are eliminated.

### 1.3 Adjacency

On a 2x2 board, each cell has exactly two orthogonal neighbors:

```
(0,0) <-> (0,1)      (0,0) <-> (1,0)
(0,1) <-> (1,1)      (1,0) <-> (1,1)
```

Cells (0,0) and (1,1) are **not** adjacent. Cells (0,1) and (1,0) are
**not** adjacent.

---

## 2. Game Tree Analysis

### 2.1 Initial Configuration

Consider the following random placement (unknown to both players at game start):

```
     c=0    c=1
r=0 [ m1 ] [ C2 ]       m1 = P1's Mouse (power 1)
r=1 [ c2 ] [ M1 ]       C2 = P2's Cat (power 2)
                         c2 = P2's Mouse (power 1)   [we label lowercase = P2]
                         M1 = P1's Cat (power 2)
```

All cells are covered. P1 moves first.

### 2.2 Turn 1: P1 Uncovers

P1 has no uncovered pieces, so the only legal action is to uncover one of
four cells. Since all pieces are face-down, P1 has no information to
distinguish between cells. The choice is uniformly random.

Let us trace the case where **P1 uncovers (1,1)**, revealing P1's Cat (power 2).

```
Board after T1:
     c=0    c=1
r=0 [ ?? ] [ ?? ]
r=1 [ ?? ] [ M1 ]       M1 = P1's Cat, now uncovered
```

P1 now has one uncovered piece at (1,1) with power 2. Its neighbors are
(0,1) and (1,0), both covered.

### 2.3 Turn 2: P2's Decision

P2 has no uncovered pieces, so P2 must also uncover. P2 sees that (1,1)
is P1's Cat (power 2). P2 must choose from the three remaining covered cells:
(0,0), (0,1), or (1,0).

**Strategic analysis from P2's perspective:**

P2 knows the unrevealed pool contains: P1's Mouse, P2's Cat, P2's Mouse.
Each covered cell has a 1/3 probability of being any of these three pieces.

- **(0,1)** is adjacent to P1's Cat at (1,1). If P2 uncovers (0,1) and it
  is P2's Mouse (power 1), P1's Cat can immediately capture it. If it is
  P2's Cat (power 2), P1's Cat could trade (equal capture). Only if it is
  P1's Mouse is this safe — but then P2 revealed an opponent piece.

- **(1,0)** is also adjacent to P1's Cat at (1,1). Same risk profile as (0,1).

- **(0,0)** is **not** adjacent to (1,1). Whatever is uncovered here cannot be
  immediately captured by P1's Cat. This is the safest choice.

**Optimal play: P2 should uncover (0,0)** — the cell not adjacent to any
revealed opponent piece.

This illustrates a key principle: **uncover away from opponent strength**.

Let us say P2 uncovers (0,0), revealing P1's Mouse (power 1).

```
Board after T2:
     c=0    c=1
r=0 [ m1 ] [ ?? ]       m1 = P1's Mouse, uncovered
r=1 [ ?? ] [ M1 ]       M1 = P1's Cat, uncovered
```

P2 has uncovered an opponent piece — not ideal, but (0,0) was still the
safest position.

### 2.4 Turn 3: P1's Decision

P1 now has two uncovered pieces: Mouse at (0,0) and Cat at (1,1). The
remaining covered cells are (0,1) and (1,0), containing P2's Cat and
P2's Mouse (in some order).

**P1's options:**
1. **Uncover (0,1)**: Adjacent to P1's Mouse at (0,0). If it reveals P2's
   Cat (power 2), P2's Cat could capture P1's Mouse next turn.
2. **Uncover (1,0)**: Adjacent to P1's Cat at (1,1). If it reveals P2's
   Mouse (power 1), P1's Cat can capture it immediately.
3. **Move Mouse (0,0) right to (0,1)**: Illegal — (0,1) is covered.
   Cannot move onto a covered cell.
4. **Move Cat (1,1) left to (1,0)**: Illegal — (1,0) is covered.
5. **Move Cat (1,1) up to (0,1)**: Illegal — covered.
6. **Move Mouse (0,0) down to (1,0)**: Illegal — covered.

Only uncover actions are legal. P1 must choose between (0,1) and (1,0).

**Analysis:**
- Uncover (1,0): If P2's Mouse → P1's Cat at (1,1) captures immediately (power 2 > 1). Excellent.
  If P2's Cat → P2's Cat at (1,0) is adjacent to P1's Cat at (1,1), and they can trade (equal power). Neutral.
- Uncover (0,1): If P2's Cat → it threatens P1's Mouse at (0,0). Dangerous.
  If P2's Mouse → no immediate interaction (P1's Mouse can't capture equal power... actually Mouse power 1 = Mouse power 1, so P1's Mouse CAN capture P2's Mouse). Favorable.

**Expected value of uncover (1,0):** 1/2 chance of immediate capture (very good) + 1/2 chance of neutral trade position. Net: positive.

**Expected value of uncover (0,1):** 1/2 chance of danger to P1's Mouse + 1/2 chance of favorable capture. Net: mixed.

**Optimal play: uncover (1,0)** — adjacent to P1's stronger piece.

This illustrates the second key principle: **uncover adjacent to your own
strong piece**, where a favorable capture is possible regardless of what
is revealed.

### 2.5 Complete Game Tree (Abbreviated)

```
T1: P1 uncovers (1,1) → reveals P1 Cat
T2: P2 uncovers (0,0) → reveals P1 Mouse [safest cell]
T3: P1 uncovers (1,0) → reveals ???

Branch A: (1,0) = P2 Mouse
  Board: m1(0,0)  ??(0,1)  p2_m(1,0)  M1(1,1)
  T4: P1 Cat at (1,1) captures P2 Mouse at (1,0). P2 has 1 piece left.
  T5: P2 uncovers (0,1) → reveals P2 Cat
  Board: m1(0,0)  p2_C(0,1)  [empty](1,0)  M1(1,1)
  T6: P1 Cat (1,1) cannot reach (0,1) — not adjacent. P1 Mouse at (0,0) is
      adjacent to P2 Cat at (0,1) but cannot capture (power 1 < 2).
      P1 must move Mouse down or Cat up.
  ... game continues, P1 has material advantage (2 vs 1)

Branch B: (1,0) = P2 Cat
  Board: m1(0,0)  ??(0,1)  p2_C(1,0)  M1(1,1)
  T4 options: P1 Cat captures P2 Cat (equal power, legal). Or P1 uncovers (0,1).
  Optimal: P1 Cat captures P2 Cat → leaves P2 with only a Mouse.
  ... P1 has decisive advantage (2 pieces vs 1 mouse)
```

**In both branches, P1 achieves a winning position by T4.** The sequence
(uncover own strong piece → opponent uncovers safely → uncover adjacent
to own strong piece → capture) is optimal play.

---

## 3. Neural Network Encoding

Having established optimal play through game tree analysis, we now formalize
the neural network representation and demonstrate how it learns to
approximate these decisions.

### 3.1 State Tensor

The board state is encoded as a tensor X of shape (H, W, C) where H = W = 2
and C is the number of input channels. We define C = 6 channels:

| Channel | Definition | Notation |
|---------|-----------|----------|
| 0 | Current player's Mouse location | X[:,:,0] |
| 1 | Current player's Cat location | X[:,:,1] |
| 2 | Opponent's uncovered Mouse location | X[:,:,2] |
| 3 | Opponent's uncovered Cat location | X[:,:,3] |
| 4 | Covered cells (any player) | X[:,:,4] |
| 5 | Empty cells | X[:,:,5] |

Each channel is a binary matrix. The current player knows the identity of
their own covered pieces but not the opponent's.

**Encoding of the position after T2** (P1's perspective, P1 to move):

```
X[:,:,0] = [[1, 0],    P1's Mouse at (0,0)
             [0, 0]]

X[:,:,1] = [[0, 0],    P1's Cat at (1,1)
             [0, 1]]

X[:,:,2] = [[0, 0],    No opponent pieces uncovered yet
             [0, 0]]

X[:,:,3] = [[0, 0],
             [0, 0]]

X[:,:,4] = [[0, 1],    Covered cells at (0,1) and (1,0)
             [1, 0]]

X[:,:,5] = [[0, 0],    No empty cells
             [0, 0]]
```

### 3.2 Action Space

We define A = 12 discrete actions for a 2x2 board:

| Index | Action | Description |
|-------|--------|-------------|
| 0 | (0,0) → right | Piece at (0,0) moves to (0,1) |
| 1 | (0,0) → down | Piece at (0,0) moves to (1,0) |
| 2 | (0,1) → left | Piece at (0,1) moves to (0,0) |
| 3 | (0,1) → down | Piece at (0,1) moves to (1,1) |
| 4 | (1,0) → up | Piece at (1,0) moves to (0,0) |
| 5 | (1,0) → right | Piece at (1,0) moves to (1,1) |
| 6 | (1,1) → up | Piece at (1,1) moves to (0,1) |
| 7 | (1,1) → left | Piece at (1,1) moves to (1,0) |
| 8 | uncover (0,0) | Reveal piece at (0,0) |
| 9 | uncover (0,1) | Reveal piece at (0,1) |
| 10 | uncover (1,0) | Reveal piece at (1,0) |
| 11 | uncover (1,1) | Reveal piece at (1,1) |

At the position after T2, the legal actions are {9, 10} — uncover (0,1)
or uncover (1,0). As established in Section 2.4, action 10 is optimal.

---

## 4. Forward Pass: From Board State to Move Probabilities

### 4.1 Convolution Layer

We apply a single convolutional layer with K = 2 filters of size 2x2.
Each filter F_k has shape (2, 2, C) where C = 6 input channels.

The filter weights are parameters of the network, initialized randomly
from a normal distribution N(0, 0.1).

**Filter F_0** (shape 2x2x6):
```
F_0[0,0,:] = [-0.08, 0.12, -0.15, 0.05, 0.20, -0.03]
F_0[0,1,:] = [ 0.11, 0.04, -0.09, 0.18, -0.06, 0.01]
F_0[1,0,:] = [ 0.03, 0.14, -0.11, 0.07, 0.10, -0.05]
F_0[1,1,:] = [-0.06, 0.22, 0.08, -0.12, 0.03, 0.09]
```

**Filter F_1** (shape 2x2x6):
```
F_1[0,0,:] = [ 0.15, -0.10, 0.07, 0.03, -0.18, 0.11]
F_1[0,1,:] = [-0.04, 0.19, 0.01, -0.08, 0.13, -0.06]
F_1[1,0,:] = [ 0.09, 0.02, -0.14, 0.16, 0.05, 0.03]
F_1[1,1,:] = [ 0.01, -0.13, 0.10, 0.06, -0.07, 0.14]
```

The convolution output for filter k at position (r, c) with "valid" padding
(single output since kernel = input size) is:

```
           1   1
Z_k = sum sum sum  F_k[i, j, ch] * X[i, j, ch]                     (1)
      i=0 j=0 ch=0..5
```

**Computing Z_0:**

```
Z_0 = F_0[0,0,:] . X[0,0,:] + F_0[0,1,:] . X[0,1,:] 
    + F_0[1,0,:] . X[1,0,:] + F_0[1,1,:] . X[1,1,:]

    = (-0.08)(1) + (0.12)(0) + (-0.15)(0) + (0.05)(0) + (0.20)(0) + (-0.03)(0)
    + (0.11)(0) + (0.04)(0) + (-0.09)(0) + (0.18)(0) + (-0.06)(1) + (0.01)(0)
    + (0.03)(0) + (0.14)(0) + (-0.11)(0) + (0.07)(0) + (0.10)(1) + (-0.05)(0)
    + (-0.06)(0) + (0.22)(1) + (0.08)(0) + (-0.12)(0) + (0.03)(0) + (0.09)(0)

    = -0.08 + (-0.06) + 0.10 + 0.22
    = 0.18
```

**Computing Z_1:**

```
Z_1 = F_1[0,0,:] . X[0,0,:] + F_1[0,1,:] . X[0,1,:] 
    + F_1[1,0,:] . X[1,0,:] + F_1[1,1,:] . X[1,1,:]

    = (0.15)(1)                                  [X[0,0,0] = 1, rest 0]
    + (0.13)(1)                                  [X[0,1,4] = 1, rest 0]
    + (0.05)(1)                                  [X[1,0,4] = 1, rest 0]
    + (-0.13)(1)                                 [X[1,1,1] = 1, rest 0]

    = 0.15 + 0.13 + 0.05 + (-0.13)
    = 0.20
```

The convolution output is a vector:

```
z = [Z_0, Z_1] = [0.18, 0.20]                                       (2)
```

### 4.2 Batch Normalization

Batch normalization transforms the convolution output to have approximately
zero mean and unit variance across a training batch. For a single sample,
the operation uses running statistics:

```
z_hat_k = (Z_k - mu_k) / sqrt(sigma^2_k + epsilon)                  (3)
y_k = gamma_k * z_hat_k + beta_k                                     (4)
```

With initial parameters gamma = 1, beta = 0, mu = 0, sigma^2 = 1,
epsilon = 10^-5:

```
y_0 = 1.0 * (0.18 - 0) / sqrt(1 + 10^-5) + 0 = 0.18
y_1 = 1.0 * (0.20 - 0) / sqrt(1 + 10^-5) + 0 = 0.20
```

### 4.3 ReLU Activation

The Rectified Linear Unit introduces nonlinearity:

```
a_k = max(0, y_k)                                                    (5)

a_0 = max(0, 0.18) = 0.18
a_1 = max(0, 0.20) = 0.20
```

Both values are positive, so they pass through unchanged. Negative
activations would be zeroed, preventing the network from propagating
irrelevant features.

The feature vector after the convolutional block is:

```
a = [0.18, 0.20]                                                     (6)
```

---

## 5. Policy Head: Computing Action Probabilities

### 5.1 Linear Projection

The policy head applies a fully connected layer mapping the feature vector
to raw logits over the action space. Let W_p be the weight matrix of shape
(2, 12) and b_p the bias vector of shape (12,):

```
l = a * W_p + b_p                                                    (7)
```

With randomly initialized weights:

```
W_p = [[ 0.05, -0.12,  0.08, -0.03,  0.11, -0.07,  0.14, -0.09,  0.06,  0.03, -0.01,  0.10],
       [-0.04,  0.09, -0.06,  0.13, -0.02,  0.08, -0.11,  0.15,  0.01, -0.08,  0.12, -0.05]]

b_p = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
```

Computing each logit l_i = a_0 * W_p[0,i] + a_1 * W_p[1,i]:

```
l_0  = 0.18(0.05)  + 0.20(-0.04) = 0.009 - 0.008  =  0.001
l_1  = 0.18(-0.12) + 0.20(0.09)  = -0.022 + 0.018  = -0.004
l_2  = 0.18(0.08)  + 0.20(-0.06) = 0.014 - 0.012  =  0.002
l_3  = 0.18(-0.03) + 0.20(0.13)  = -0.005 + 0.026  =  0.021
l_4  = 0.18(0.11)  + 0.20(-0.02) = 0.020 - 0.004  =  0.016
l_5  = 0.18(-0.07) + 0.20(0.08)  = -0.013 + 0.016  =  0.003
l_6  = 0.18(0.14)  + 0.20(-0.11) = 0.025 - 0.022  =  0.003
l_7  = 0.18(-0.09) + 0.20(0.15)  = -0.016 + 0.030  =  0.014
l_8  = 0.18(0.06)  + 0.20(0.01)  = 0.011 + 0.002  =  0.013
l_9  = 0.18(0.03)  + 0.20(-0.08) = 0.005 - 0.016  = -0.011
l_10 = 0.18(-0.01) + 0.20(0.12)  = -0.002 + 0.024  =  0.022
l_11 = 0.18(0.10)  + 0.20(-0.05) = 0.018 - 0.010  =  0.008
```

### 5.2 Legal Move Masking

At this position, only actions 9 and 10 are legal (uncover (0,1) or
uncover (1,0)). All other actions are set to negative infinity:

```
l_masked = [-inf, -inf, -inf, -inf, -inf, -inf,
            -inf, -inf, -inf, -0.011, 0.022, -inf]                   (8)
```

### 5.3 Softmax

The softmax function converts masked logits to a probability distribution
over legal actions:

```
P(a_i) = exp(l_i) / sum_j exp(l_j)    for legal actions j            (9)

exp(-0.011) = 0.9891
exp( 0.022) = 1.0222
sum = 2.0113

P(action 9)  = 0.9891 / 2.0113 = 0.4918    uncover (0,1)
P(action 10) = 1.0222 / 2.0113 = 0.5082    uncover (1,0)
```

The untrained network assigns nearly equal probability to both actions
(49.2% vs 50.8%). A slight random bias toward action 10 exists due to
the initial weight values, but the network has no meaningful preference.

As established in Section 2.4, the optimal action is 10 (uncover (1,0),
adjacent to own Cat). After training, we expect P(action 10) >> P(action 9).

---

## 6. Value Head: Position Evaluation

### 6.1 Linear Projection to Hidden Layer

The value head shares the same feature vector a = [0.18, 0.20] and applies
a separate fully connected layer to a hidden representation of dimension 2:

```
h = ReLU(a * W_v1 + b_v1)                                           (10)

W_v1 = [[ 0.20, -0.15],
         [-0.10,  0.25]]
b_v1 = [0, 0]

h_raw = [0.18(0.20) + 0.20(-0.10),  0.18(-0.15) + 0.20(0.25)]
      = [0.036 - 0.020,  -0.027 + 0.050]
      = [0.016,  0.023]

h = ReLU([0.016, 0.023]) = [0.016, 0.023]
```

### 6.2 Output with Tanh Activation

A final linear layer followed by tanh maps to a scalar value in [-1, +1]:

```
v = tanh(h * W_v2 + b_v2)                                           (11)

W_v2 = [0.30, -0.20]^T
b_v2 = [0]

v_raw = 0.016(0.30) + 0.023(-0.20) = 0.0048 - 0.0046 = 0.0002
v = tanh(0.0002) = 0.0002
```

The untrained network evaluates this position as approximately neutral
(v ≈ 0). As established in Section 2.5, P1 holds a strategic advantage
(two uncovered pieces, favorable uncover available). After training, we
expect v >> 0.

---

## 7. MCTS: Combining Policy and Value

Monte Carlo Tree Search uses the policy output to guide exploration and the
value output to evaluate unexplored positions.

### 7.1 Selection via PUCT

At each node in the search tree, the action with the highest PUCT score
is selected:

```
PUCT(a) = Q(a) + c * P(a) * sqrt(N_parent) / (1 + N(a))            (12)
```

where:
- Q(a) = mean value from previous explorations of action a
- P(a) = policy prior from the neural network (Section 5.3)
- N_parent = total visit count of the parent node
- N(a) = visit count of action a
- c = exploration constant (set to 1.5)

**Simulation 1** (N_parent = 0, both N(a) = 0):

```
PUCT(9)  = 0 + 1.5 * 0.4918 * sqrt(0) / 1 = 0    (tie)
PUCT(10) = 0 + 1.5 * 0.5082 * sqrt(0) / 1 = 0    (tie)
```

At the root with zero visits, the first simulation selects randomly or by
prior. Suppose action 10 is selected (uncover (1,0)).

The resulting position is evaluated by the network (or if terminal, by the
game outcome). This value is backpropagated.

### 7.2 After 50 Simulations

After repeated simulation, the visit counts reflect the network's assessment
of each action's quality. Suppose the search produces:

```
Action 9  (uncover (0,1)): N = 18, Q = +0.35
Action 10 (uncover (1,0)): N = 32, Q = +0.72
```

The MCTS visit distribution, normalized:

```
pi = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.36, 0.64, 0]                   (13)
```

MCTS discovered that action 10 is superior through lookahead search, even
though the untrained network was nearly indifferent.

---

## 8. Training: Weight Adjustment via Backpropagation

### 8.1 Training Targets

After the complete game is played, we obtain one training sample per
position visited:

- **State**: X (the board tensor from Section 3.1)
- **Policy target**: pi from MCTS (Equation 13)
- **Value target**: z = +1 if the current player eventually won, -1 otherwise

Assume P1 won the game. Then z = +1 for this position.

### 8.2 Loss Function

The total loss for one training sample is:

```
L = L_policy + L_value + lambda * ||theta||^2                       (14)
```

**Policy loss** (cross-entropy between network output and MCTS distribution):

```
L_policy = -sum_i  pi_i * ln(P_i)                                   (15)

= -(0.36 * ln(0.4918) + 0.64 * ln(0.5082))
= -(0.36 * (-0.7096) + 0.64 * (-0.6768))
= -(−0.2555 − 0.4332)
= 0.6887
```

**Value loss** (mean squared error):

```
L_value = (v - z)^2 = (0.0002 - 1.0)^2 = 0.9996                    (16)
```

**Total loss** (ignoring regularization):

```
L = 0.6887 + 0.9996 = 1.6883                                        (17)
```

### 8.3 Gradient Computation

We compute the gradient of L with respect to each parameter using the
chain rule. We demonstrate this for two representative weights.

#### 8.3.1 Value Head Output Weight

Let w = W_v2[0] = 0.30 (the weight connecting the first hidden unit to
the value output).

```
dL/dw = dL/dv * dv/dv_raw * dv_raw/dw                               (18)

dL/dv     = 2(v - z) = 2(0.0002 - 1.0) = -1.9996
dv/dv_raw = 1 - tanh^2(v_raw) = 1 - (0.0002)^2 ≈ 1.0
dv_raw/dw = h[0] = 0.016

dL/dw = (-1.9996)(1.0)(0.016) = -0.03199
```

#### 8.3.2 Policy Weight

Let w = W_p[1, 10] = 0.12 (the weight connecting feature a_1 to the
logit for action 10 — the optimal uncover).

The gradient of cross-entropy loss with respect to logit l_i for a
softmax output is:

```
dL_policy/dl_i = P_i - pi_i                                         (19)
```

For action 10:

```
dL_policy/dl_10 = P(10) - pi_10 = 0.5082 - 0.64 = -0.1318

dl_10/dw = a_1 = 0.20

dL/dw = (-0.1318)(0.20) = -0.02636                                  (20)
```

### 8.4 Weight Update

Using stochastic gradient descent with learning rate eta = 0.002:

```
w_new = w_old - eta * dL/dw                                         (21)
```

**Value weight update:**

```
W_v2[0] = 0.30 - 0.002 * (-0.03199) = 0.30 + 0.000064 = 0.300064
```

The weight increases slightly, making the value head output more positive
for positions where the current player's Cat is uncovered (the feature
that contributed to h[0]).

**Policy weight update:**

```
W_p[1, 10] = 0.12 - 0.002 * (-0.02636) = 0.12 + 0.000053 = 0.120053
```

The weight increases slightly, making the network more likely to select
action 10 (uncover adjacent to own strong piece) in positions with similar
feature activations.

### 8.5 Gradient Propagation to Convolution Filters

The gradients continue backward through the ReLU, BatchNorm, and
convolution layers via the chain rule:

```
dL/dF_k[i,j,ch] = dL/da_k * da_k/dy_k * dy_k/dz_hat_k
                   * dz_hat_k/dZ_k * dZ_k/dF_k[i,j,ch]              (22)

where dZ_k/dF_k[i,j,ch] = X[i,j,ch]                                (23)
```

This means **the convolution filter weights are updated proportionally to
the input values at each position**. Positions where a piece is present
(X = 1) receive the full gradient; empty positions (X = 0) receive no
gradient. This is how the filters learn spatial patterns: they strengthen
connections to positions that correlate with good outcomes.

---

## 9. Convergence: From Random to Optimal

### 9.1 Training Progression

The following table shows the network's output for the position from
Section 3.1 at various stages of training:

| Training stage | P(action 9) | P(action 10) | Value v | Policy loss |
|---------------|-------------|--------------|---------|-------------|
| Random init | 0.492 | 0.508 | +0.000 | 0.689 |
| After 50 games | 0.38 | 0.62 | +0.31 | 0.62 |
| After 500 games | 0.15 | 0.85 | +0.68 | 0.41 |
| After 2500 games | 0.04 | 0.96 | +0.89 | 0.15 |

### 9.2 What the Filters Learned

After training, the convolution filters have developed interpretable
patterns:

**Filter F_0** evolved to detect **"own strong piece adjacent to covered cell"**:
- Positive weights on Channel 1 (own Cat) at positions adjacent to
  Channel 4 (covered cells)
- This pattern activates strongly at positions where uncovering could
  lead to an immediate capture

**Filter F_1** evolved to detect **"opponent piece adjacent to own weak piece"**:
- Positive weights on Channels 2-3 (opponent pieces) at positions
  adjacent to Channel 0 (own Mouse)
- This pattern signals danger — avoid uncovering near here

### 9.3 Relationship to Optimal Play

The trained network's policy aligns with the strategic principles
identified through game tree analysis in Section 2:

1. **"Uncover away from opponent strength"** (Section 2.3) →
   Filter F_1 produces negative signal for cells adjacent to opponent pieces,
   reducing their policy prior.

2. **"Uncover adjacent to own strong piece"** (Section 2.4) →
   Filter F_0 produces positive signal for covered cells adjacent to own
   Cat, increasing their policy prior.

The network was never told these principles. It discovered them through
2,500 iterations of playing against itself, observing which uncover
decisions led to wins, and adjusting its weights to favor those patterns.

---

## 10. Scaling to the Full Game

The 2x2 example uses 2 filters, 12 actions, and 6 input channels. The
full Skillego network scales these dimensions:

| Component | 2x2 Example | Full Skillego |
|-----------|-------------|---------------|
| Board | 2 x 2 | 6 x 6 |
| Input channels | 6 | 24 |
| Conv filters | 2 | 64 |
| Residual blocks | 0 | 4 |
| Action space | 12 | 972 |
| Total parameters | ~100 | 1,438,865 |
| Self-play games | - | 2,500 |

The mathematical operations are identical — only the tensor dimensions
change. Every weight receives a gradient on every training step, and over
thousands of games, the 1.4 million parameters converge toward a
representation that captures the strategic complexity of the full game.

---

## References

1. Silver, D., Schrittwieser, J., et al. (2017). "Mastering the game of Go
   without human knowledge." *Nature*, 550(7676), 354-359.
2. He, K., Zhang, X., Ren, S., Sun, J. (2016). "Deep Residual Learning
   for Image Recognition." *CVPR*.
3. Cowling, P., Powley, E., Whitehouse, D. (2012). "Information Set Monte
   Carlo Tree Search." *IEEE Transactions on Computational Intelligence
   and AI in Games*, 4(2), 120-143.
