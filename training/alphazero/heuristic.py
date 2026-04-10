"""
Heuristic policy for warmup training.

Generates training data from games played with a simple rule-based policy,
giving the neural network a reasonable starting point before self-play.
The heuristic captures the tactical rules the user identified (see feedback_gameplay.md).
"""
import random
import math
import numpy as np
from .config import (
    BOARD_ROWS, BOARD_COLS, DEFAULT_ABILITIES, MAX_MOVES_PER_GAME,
    ACTION_SPACE_SIZE,
)
from .game_engine import (
    GameState, create_initial_state, get_all_moves, apply_move,
    is_terminal, get_winner, can_capture, encode_state,
    in_bounds, DIRS, count_pieces,
)
from .action_space import move_to_action


def heuristic_score_move(state, move, player):
    """Score a move using simple heuristics. Higher = better."""
    mt = move['type']
    score = 0.0

    if mt == 'capture':
        cap_power = move.get('cap_power', 0)
        attacker = state.board[move['from_r']][move['from_c']]
        # Mouse capturing dragon is the best move in the game
        if attacker and attacker['type'] == 'mouse' and cap_power == 6:
            return 1000.0
        # High-value captures
        score = cap_power * 20
        # Prefer capturing with weaker pieces (less risk)
        if attacker:
            score += (6 - attacker['power']) * 2

    elif mt == 'snipe':
        target = state.board[move['target_r']][move['target_c']]
        score = 80 + (target['power'] * 10 if target else 0)

    elif mt == 'move':
        fr, fc = move['from_r'], move['from_c']
        tr, tc = move['to_r'], move['to_c']
        piece = state.board[fr][fc]
        if not piece:
            return 0

        # Move toward opponent uncovered pieces
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                opp = state.board[r][c]
                if opp and opp['player'] != player and not state.covered[r][c]:
                    old_dist = abs(fr - r) + abs(fc - c)
                    new_dist = abs(tr - r) + abs(tc - c)
                    if new_dist < old_dist:
                        # Moving toward opponent is good, especially for mice toward dragon
                        bonus = 3
                        if piece['type'] == 'mouse' and opp['type'] == 'dragon':
                            bonus = 15
                        elif piece['power'] >= opp['power']:
                            bonus = 5
                        score += bonus

        # Small random noise for variety
        score += random.random() * 2

    elif mt == 'uncover':
        r, c = move['r'], move['c']
        # Prefer uncovering near opponent pieces (chance to find useful piece)
        for dr, dc in DIRS:
            nr, nc = r + dr, c + dc
            if in_bounds(nr, nc):
                adj = state.board[nr][nc]
                if adj and adj['player'] != player and not state.covered[nr][nc]:
                    score += 5
        score += random.random() * 8  # randomize uncover choices

    elif mt == 'hop':
        score = 10 + random.random() * 5

    elif mt == 'push':
        score = 15 + random.random() * 5

    elif mt == 'engulf':
        score = 20  # only generated when near enemy mouse

    elif mt == 'transform':
        score = 12 + random.random() * 5

    elif mt == 'pyro':
        target = state.board[move['target_r']][move['target_c']]
        score = 18 + (target['power'] * 3 if target else 0)

    return score


def heuristic_select_move(state, player, abilities=DEFAULT_ABILITIES, temperature=0.5):
    """Select a move using heuristic scoring with temperature-based sampling.

    Returns (move, policy_vector) where policy is softmax over scores.
    """
    legal = get_all_moves(state, player, abilities)
    if not legal:
        return None, np.zeros(ACTION_SPACE_SIZE, dtype=np.float32)

    scores = [heuristic_score_move(state, m, player) for m in legal]

    # Softmax with temperature
    scores = np.array(scores, dtype=np.float64)
    if temperature > 0:
        scores = scores / temperature
    scores -= scores.max()
    exp_scores = np.exp(scores)
    probs = exp_scores / exp_scores.sum()

    # Build policy vector
    policy = np.zeros(ACTION_SPACE_SIZE, dtype=np.float32)
    for m, p in zip(legal, probs):
        policy[move_to_action(m)] = p

    # Sample
    chosen_idx = np.random.choice(len(legal), p=probs)
    return legal[chosen_idx], policy


def play_heuristic_game(abilities=DEFAULT_ABILITIES, temperature=0.5):
    """Play a full game using heuristic policy. Returns training samples."""
    state = create_initial_state()
    current_player = 1
    samples = []
    move_count = 0

    while not is_terminal(state) and move_count < MAX_MOVES_PER_GAME:
        move, policy = heuristic_select_move(state, current_player, abilities, temperature)
        if move is None:
            current_player = 3 - current_player
            move_count += 1
            continue

        # Store sample
        state_tensor = encode_state(state, current_player, abilities)
        samples.append((state_tensor, policy, current_player))

        state = apply_move(state, move)
        current_player = 3 - current_player
        move_count += 1

    winner = get_winner(state)
    return samples, winner, move_count


def generate_warmup_data(num_games, abilities=DEFAULT_ABILITIES, verbose=False):
    """Generate training data from heuristic games for NN warmup."""
    import time

    all_states = []
    all_policies = []
    all_values = []
    wins = {0: 0, 1: 0, 2: 0}
    total_moves = 0
    start = time.time()

    for i in range(num_games):
        samples, winner, num_moves = play_heuristic_game(abilities, temperature=0.5)
        wins[winner] = wins.get(winner, 0) + 1
        total_moves += num_moves

        if samples:
            for s_tensor, policy, player in samples:
                all_states.append(s_tensor)
                all_policies.append(policy)
                if winner == 0:
                    all_values.append(0.0)
                elif winner == player:
                    all_values.append(1.0)
                else:
                    all_values.append(-1.0)

        if verbose and (i + 1) % 50 == 0:
            elapsed = time.time() - start
            w = f"P{winner}" if winner else "draw"
            print(f"  Warmup game {i+1}/{num_games}: {w}, {num_moves} moves "
                  f"({elapsed:.0f}s elapsed)", flush=True)

    elapsed = time.time() - start
    states = np.array(all_states, dtype=np.float32) if all_states else np.zeros((0,))
    policies = np.array(all_policies, dtype=np.float32) if all_policies else np.zeros((0,))
    values = np.array(all_values, dtype=np.float32).reshape(-1, 1) if all_values else np.zeros((0,))

    stats = {
        'num_games': num_games,
        'p1_wins': wins.get(1, 0),
        'p2_wins': wins.get(2, 0),
        'draws': wins.get(0, 0),
        'avg_moves': total_moves / max(1, num_games),
        'total_samples': len(all_states),
        'elapsed_sec': elapsed,
    }
    return states, policies, values, stats
