# SkillZero — AlphaZero-style AI for Skillego

Trains a neural network to play Skillego using self-play and Monte Carlo Tree Search.
The NN learns both **what moves to consider** (policy) and **who's winning** (value)
entirely from playing against itself — no hand-crafted evaluation rules.

## How It Works

### The Core Loop

```
┌─────────────────────────────────────────────────────────┐
│                    TRAINING ITERATION                    │
│                                                         │
│  1. SELF-PLAY                                           │
│     Current NN + MCTS play games against themselves     │
│     ┌───────────────────────────────────────┐           │
│     │  For each move:                       │           │
│     │    • NN suggests promising moves      │ ──► Store │
│     │    • MCTS searches 50-200 moves deep  │    data   │
│     │    • Pick move based on search results│           │
│     └───────────────────────────────────────┘           │
│     Output: (board_state, search_results, who_won)      │
│                                                         │
│  2. TRAIN                                               │
│     Update NN on accumulated game data                  │
│     • Policy target: "MCTS visited these moves most"    │
│     • Value target:  "this position led to a win/loss"  │
│                                                         │
│  3. EVALUATE                                            │
│     Pit new NN against previous best ("champion")       │
│     If new NN wins >55%, it becomes the champion        │
│                                                         │
│  Repeat. Each iteration the NN gets stronger,           │
│  which makes MCTS search better, which generates        │
│  better training data. Virtuous cycle.                  │
└─────────────────────────────────────────────────────────┘
```

### Phase 0: Heuristic Warmup (runs once at start)

A random neural network plays terribly — games last 300 moves and end in draws,
producing useless training data. To bootstrap:

- Play **500 fast games** using a simple rule-based policy (captures high-value pieces,
  moves toward enemies, prioritizes mouse-kills-dragon)
- These games finish in ~100-150 moves with real winners
- Pre-train the NN on this data so it starts with basic tactical awareness
- Takes ~15 seconds + ~30 seconds training

After warmup, the NN knows basics: "capturing is good, losing pieces is bad,
mouse should chase dragon." Self-play takes over from here.

### Phase 1: AlphaZero Self-Play

Each iteration:

1. **Generate 25 self-play games** using MCTS guided by the current NN
   - For each move, MCTS runs 50 simulations across 2 "determinized" worlds
     (random guesses at what the hidden pieces are)
   - Early moves: explore (temperature=1.0, try different things)
   - Late moves: exploit (temperature->0, play the best move)
   - Each game produces ~100-200 training samples

2. **Train the NN** on the replay buffer (last 50K positions)
   - Policy loss: teach the NN to predict what MCTS would search
   - Value loss: teach the NN to predict who wins from any position
   - 10 epochs per iteration

3. **Evaluate** (every 2nd iteration): play 20 games, new vs champion
   - If the new model wins >=55%, it becomes champion
   - Champion model is saved for browser export

### Hidden Information Handling

Skillego has hidden pieces (face-down). The AI handles this with
**Information Set MCTS**:

1. The AI sees its own pieces (even covered) but not opponent's covered pieces
2. Before searching, it "determinizes": randomly fills in opponent's hidden pieces
   consistent with what's been revealed so far
3. Runs MCTS on this concrete world
4. Repeats with different random fillings (2-8 worlds)
5. Aggregates results across all worlds for the final decision

This is the same approach the current JS "Genius" MCTS uses, but with a neural
network replacing the hand-crafted evaluation function.

### What the Neural Network Sees

**Input** (24 channels on a 6x6 board):
- Channels 0-5: Own pieces by type (mouse, cat, dog, wizard, robot, dragon)
- Channels 6-11: Opponent's revealed pieces by type
- Channel 12: Own covered pieces (knows position, already knows type)
- Channel 13: Opponent covered pieces (knows position, NOT type)
- Channel 14: Empty cells
- Channels 15-16: Burning piece status
- Channel 17: Bias
- Channels 18-23: Which abilities are enabled

**Output**:
- **Policy**: 972 probabilities over all possible actions
  (27 action types x 36 board positions)
- **Value**: Single number from -1 (losing) to +1 (winning)

### Action Space (972 actions)

Every possible move in Skillego maps to one of 972 action slots:

| Planes | Action Type | Count |
|--------|------------|-------|
| 0-3    | Move/Capture (N,E,S,W) | 144 |
| 4      | Uncover | 36 |
| 5-8    | Mouse Hop (N,E,S,W) | 144 |
| 9-12   | Dragon Push (N,E,S,W) | 144 |
| 13     | Dragon Engulf | 36 |
| 14-17  | Wizard Transform Line (N,E,S,W) | 144 |
| 18     | Wizard Transform Explode | 36 |
| 19-22  | Robot Snipe (N,E,S,W) | 144 |
| 23-26  | Pyro Spread (N,E,S,W) | 144 |
| **Total** | | **972** |

## Time Estimates

### CPU Only (this machine)

| Phase | Duration | What happens |
|-------|----------|-------------|
| Warmup | ~1 minute | 500 heuristic games + pre-training |
| 1 iteration | ~40-50 min | 25 self-play games + training + eval |
| 10 iterations | ~7-8 hours | NN starts learning basic tactics |
| 50 iterations | ~2 nights | NN should play competently |
| 100+ iterations | ~4-5 nights | NN discovers non-obvious strategies |

**Overnight run (8 hours):** ~10-12 iterations, ~300 self-play games.

### With GPU (home PC via WSL2)

| Phase | Duration | What happens |
|-------|----------|-------------|
| Warmup | ~1 minute | Same (heuristic games are pure Python) |
| 1 iteration | ~5-10 min | 8-10x faster NN inference |
| 10 iterations | ~1-2 hours | Basic tactical play emerges |
| 50 iterations | ~5-8 hours | Competent play — one night |
| 100+ iterations | ~1-2 nights | Novel strategy discovery |

**Important:** TensorFlow GPU does NOT work on native Windows (TF >= 2.11).
Use **WSL2** (Windows Subsystem for Linux) for GPU training:

```bash
# In WSL2 Ubuntu terminal:
cd /mnt/c/EpicSource/web/skillego/training
python3 -m venv .venv-wsl
source .venv-wsl/bin/activate
pip install tensorflow[and-cuda] numpy tensorflowjs
python -u -m alphazero.train --iterations 50 --games 25
```

## Quick Start

### On this machine (CPU training)

```bash
# First time setup
setup.bat

# Full training run (runs until stopped or iterations complete)
train.bat

# Quick test (5 iterations, 10 games each)
.venv\Scripts\python.exe -u -m alphazero.train --iterations 5 --games 10

# Resume from checkpoint
.venv\Scripts\python.exe -u -m alphazero.train --resume models\checkpoint_iter10.keras

# Skip evaluation for faster iterations
.venv\Scripts\python.exe -u -m alphazero.train --no-eval
```

### Train on home PC, deploy everywhere

```bash
# 1. Pull repo on GPU machine
git pull

# 2. Setup + train (overnight)
cd training
setup.bat                    # or: python3 -m venv .venv && pip install -r requirements.txt
train.bat                    # or: python -u -m alphazero.train

# 3. Export trained model for the browser
.venv\Scripts\python.exe -m alphazero.export
# This creates js/no-modules/model/model.json + weights.bin

# 4. Commit and push the trained model
git add models/champion.keras models/training_log.jsonl
git add ../js/no-modules/model/
git commit -m "SkillZero: trained model iteration N"
git push

# 5. Anyone who pulls now gets the trained model
#    Genius difficulty auto-upgrades to NN-guided MCTS
```

### Scaling up training

Tweak `alphazero/config.py` for more compute:

```python
# More MCTS search (stronger play, slower games)
MCTS_SIMULATIONS = 200       # default: 50
NUM_DETERMINIZATIONS = 8     # default: 2

# More self-play data per iteration
SELF_PLAY_GAMES = 100        # default: 25

# More training
EPOCHS_PER_ITERATION = 20    # default: 10

# Bigger network (if you have the GPU for it)
NUM_RES_BLOCKS = 8           # default: 4
NUM_FILTERS = 128            # default: 64
```

## Output

Models are saved to `training/models/`:

| File | What |
|------|------|
| `warmup_champion.keras` | After heuristic pre-training (baseline) |
| `champion.keras` | Best model so far (use this for export) |
| `checkpoint_iterN.keras` | Periodic snapshots (every 5 iterations) |
| `final.keras` | Model at end of training run |
| `training_log.jsonl` | Per-iteration metrics (loss, win rate, timing) |

The exported browser model goes to `js/no-modules/model/`:

| File | Size | What |
|------|------|------|
| `model.json` | ~21 KB | Model topology + weight manifest |
| `weights.bin` | ~5.6 MB | Trained weight values |

## Architecture

```
SkillZero Network (1.4M parameters)
|
+-- Input: (6, 6, 24) board state
+-- Conv 3x3, 64 filters + BatchNorm + ReLU
+-- 4x Residual Blocks
|     +-- Conv 3x3, 64 + BatchNorm + ReLU
|     +-- Conv 3x3, 64 + BatchNorm
|     +-- Skip connection + ReLU
|
+-- Policy Head --> 972 action logits
|     +-- Conv 1x1, 32 + BatchNorm + ReLU
|     +-- Flatten + Dense(972)
|
+-- Value Head --> 1 scalar in [-1, +1]
      +-- Conv 1x1, 1 + BatchNorm + ReLU
      +-- Flatten + Dense(128, ReLU) + Dense(1, tanh)
```

## File Guide

```
training/
+-- alphazero/
|   +-- config.py        -- All hyperparameters (tweak these)
|   +-- game_engine.py   -- Complete Skillego rules (ported from JS)
|   +-- action_space.py  -- Move <-> action index mapping (972 actions)
|   +-- network.py       -- Neural network (TensorFlow/Keras)
|   +-- mcts.py          -- AlphaZero MCTS with NN guidance + determinization
|   +-- heuristic.py     -- Rule-based warmup policy
|   +-- self_play.py     -- Game generation + training data collection
|   +-- train.py         -- Main training loop (warmup -> self-play -> train -> eval)
|   +-- export.py        -- Convert .keras model to TF.js for browser
|   +-- test_engine.py   -- Game engine verification tests
+-- models/              -- Saved models + training log (gitignore the .venv)
+-- train.bat            -- Launch training (Windows)
+-- export.bat           -- Export champion model to browser JS
+-- setup.bat            -- Create venv + install deps
+-- requirements.txt     -- Python dependencies
+-- README.md            -- You are here
```

Browser-side files (in `js/no-modules/`):

```
nn-mcts.js     -- NN-guided MCTS (PUCT selection, state encoding, action mapping)
model/         -- Exported TF.js model (model.json + weights.bin)
```

## Why This Approach (vs what failed before)

The previous **DQN attempt** (`skillegoAI/`) failed because:
- **Sparse reward**: DQN only learns from win/loss at game end (~200 moves away)
- **Random exploration**: epsilon-greedy wastes time on obviously bad moves
- **No lookahead**: DQN picks moves greedily from Q-values, no search
- **Stalled at ~50% win rate**: only 1 champion update in 15,000 episodes

The hand-tuned **minimax** (`minimax.js`) is strong but brittle:
- Tuning one scenario breaks another
- Can't discover novel strategies — only plays what the heuristic rewards
- Evaluation function is a pile of hand-weighted terms that interact in unpredictable ways

**AlphaZero** fixes all of these:
- **Rich training signal**: MCTS visit distributions tell the NN *which moves are good
  and by how much*, not just whether the game was eventually won
- **Guided exploration**: NN policy focuses MCTS on promising moves from the start;
  Dirichlet noise adds controlled variety without wasting time on garbage
- **Deep search**: MCTS looks many moves ahead, letting the NN learn from
  positions it hasn't directly experienced
- **Self-improving**: better NN -> better MCTS -> better training data -> better NN
- **Generalizes**: the NN learns its own evaluation function from scratch,
  capturing interactions between all game mechanics naturally
