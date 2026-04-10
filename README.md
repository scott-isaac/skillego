# Skillego

A hidden-information strategy board game playable in the browser — no install, no server, no build step required.

**[Play it live](https://scott-isaac.github.io/skillego/)**

---

## What is it?

Skillego is inspired by [Jungle/Dou Shou Qi](https://en.wikipedia.org/wiki/Jungle_(board_game)) — a two-player game where all pieces start face-down and are revealed gradually as play unfolds. The combination of hidden information and tactical combat makes every game feel different.

You can play **Human vs Human**, **Human vs CPU**, or watch **CPU vs CPU** at any speed.

## How to Play

All 18 pieces per player start **face-down** on a 6x6 board.

On your turn, either:
- **Flip a covered piece** to reveal it, or
- **Move an uncovered piece** one step orthogonally (no diagonal)

Capture enemy pieces by moving onto their square. Higher power beats lower power:

| Piece | Power | Count |
|-------|-------|-------|
| Mouse | 1 | x6 |
| Cat | 2 | x4 |
| Dog | 3 | x4 |
| Wizard | 4 | x2 |
| Robot | 5 | x1 |
| Dragon | 6 | x1 |

**Special rule:** Mouse captures Dragon (but Dragon beats everything else).

**Win condition:** Eliminate all of your opponent's pieces.

### Abilities

Toggle these on the setup screen for extra depth:

- **Dragon Push** — shove an adjacent enemy one square away
- **Dragon Enflame** — become immune to mice, but lose 1 power each move
- **Mouse Hop** — jump over any adjacent piece to the square beyond
- **Wizard Transform** — permanently become 4 mice (line or explosion pattern)
- **Robot Snipe** — capture along a clear line if a friendly cat is spotting the target
- **Pyromania** — any burning piece can spread fire to an adjacent enemy

## AI Difficulty Levels

| Level | Behavior |
|-------|----------|
| Easy | Random legal moves |
| Medium | Greedy captures with some randomness |
| Hard | Weighted heuristics with anti-oscillation logic |
| Expert | Deep negamax with iterative deepening (time-budgeted, full ability support) |

Easy and Medium use minimax with noise for human-like mistakes. Hard uses adaptive-depth minimax with a hand-tuned evaluation function. Expert uses a time-budgeted negamax engine with alpha-beta pruning that searches as deep as possible within 500ms — pure material evaluation lets the search depth do the strategic work.

## Play Locally (no server needed)

Just open `index.html` in a browser:

```bash
git clone https://github.com/scott-isaac/skillego.git
cd skillego
open index.html   # or double-click it
```

All game modes work offline — Human vs Human, Human vs CPU, CPU vs CPU.

## Host Multiplayer Games

Want to play against friends over the network? The game includes a Node.js server for real-time multiplayer with game codes.

### Quick start (local network)

```bash
npm install
npm start
# Server running on http://localhost:3000
# Share your local IP with friends on the same network
```

### Docker (self-hosted, internet-accessible)

```bash
cp .env.example .env
# Edit .env — set ALLOWED_ORIGINS to your client's domain
docker compose up -d --build
```

The container runs a lightweight WebSocket server (~30MB). Point a reverse proxy
(nginx, Caddy, Cloudflare Tunnel, etc.) at port 3001 and you're live.

See [DEPLOY.md](DEPLOY.md) for full setup instructions including Cloudflare Tunnel configuration.

### How multiplayer works

1. One player creates a game and gets a **game code**
2. The other player enters the code to join
3. The server validates all moves server-side (no cheating)
4. Covered pieces are masked — neither player can see the other's hidden pieces
5. Supports Human vs Human, Human vs CPU, and spectator mode

## Tech Stack

Pure vanilla JavaScript — no frameworks, no build tools.

```
index.html          — game UI
styles.css          — styling
js/no-modules/
  constants.js      — board size, piece definitions, abilities
  state.js          — central game state
  rules.js          — capture rules, move generation, all abilities
  board.js          — board rendering and move execution
  game.js           — player input, UI flow, game lifecycle
  cpu.js            — AI difficulty routing
  minimax.js        — Expert AI (minimax + alpha-beta)
  mcts.js           — Genius AI (MCTS + determinization)
  socket-client.js  — multiplayer client (auto-detects server)
  gamelog.js         — structured game logging
server/
  index.js          — Express + Socket.io multiplayer server
  GameRoom.js       — server-side game rooms with move validation
  lib/              — server-side rules + AI engine
```
