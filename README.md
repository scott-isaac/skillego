# Skillego

A hidden-information strategy board game playable in the browser — no install, no server, no build step required.

**[Play it live →](https://[your-username].github.io/skillego/)**

---

## What is it?

Skillego is inspired by [Jungle/Dou Shou Qi](https://en.wikipedia.org/wiki/Jungle_(board_game)) — a two-player game where all pieces start face-down and are revealed gradually as play unfolds. The combination of hidden information and tactical combat makes every game feel different.

You can play **Human vs Human**, **Human vs CPU**, or watch **CPU vs CPU** at any speed.

## How to Play

All 18 pieces per player start **face-down** on a 6×6 board.

On your turn, either:
- **Flip a covered piece** to reveal it, or
- **Move an uncovered piece** one step orthogonally (no diagonal)

Capture enemy pieces by moving onto their square. Higher power beats lower power:

| Piece | Power |
|-------|-------|
| 🐭 Mouse | 1 |
| 😸 Cat | 2 |
| 🐶 Wolf | 3 |
| 🧙 Bear | 4 |
| 🤖 Eagle | 5 |
| 🐉 Dragon | 6 |

**Special rule:** 🐭 Mouse captures 🐉 Dragon (but Dragon beats everything else).

**Win condition:** Eliminate all of your opponent's pieces.

## AI Difficulty Levels

| Level | Behavior |
|-------|----------|
| Easy | Random legal moves |
| Medium | Greedy — always captures if possible, otherwise random |
| Hard | Weighted heuristics with anti-oscillation logic |
| Expert | Minimax with alpha-beta pruning (adaptive depth 3–7) |

The Expert AI uses a custom evaluation function that accounts for piece material, mobility, dragon-mouse proximity threats, attack pressure, and endgame hunt mode.

## Tech Stack

Pure vanilla JavaScript — no frameworks, no build tools, no dependencies.

```
index.html
styles.css
js/no-modules/
  constants.js   — board size, piece definitions
  state.js       — central game state
  board.js       — board rendering and move execution
  game.js        — player input, UI flow, game lifecycle
  cpu.js         — Easy / Medium / Hard AI
  minimax.js     — Expert AI (minimax + alpha-beta)
  gamelog.js     — structured move-by-move game log
  utils.js       — debug logging
  main.js        — entry point
```

## Running Locally

Just open `index.html` in a browser. No server needed.

```bash
git clone https://github.com/[your-username]/skillego.git
cd skillego
open index.html   # or double-click it
```

## Deploying to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to **Deploy from branch**, branch `main`, folder `/root`
4. Your game will be live at `https://[your-username].github.io/skillego/`
