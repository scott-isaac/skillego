"""
Self-play game generation for AlphaZero training.

Each game produces training samples: (state_tensor, policy_target, value_target).
  - state_tensor: the NN input from the current player's perspective
  - policy_target: MCTS visit distribution (what the search thinks is best)
  - value_target: eventual game outcome from current player's perspective (+1/-1)
"""
import time
import numpy as np
from .config import (
    MAX_MOVES_PER_GAME, TEMP_THRESHOLD, MCTS_SIMULATIONS,
    NUM_DETERMINIZATIONS, DEFAULT_ABILITIES,
)
from .game_engine import (
    create_initial_state, get_all_moves, apply_move,
    is_terminal, get_winner, encode_state, get_info_state,
)
from .mcts import run_ismcts


def play_game(network, abilities=DEFAULT_ABILITIES, verbose=False):
    """Play a full self-play game.

    Returns:
        samples: list of (state_tensor, policy, player) tuples
        winner: 1 or 2 (or 0 for draw/timeout)
        num_moves: total moves played
    """
    state = create_initial_state()
    current_player = 1
    samples = []
    move_count = 0

    while not is_terminal(state) and move_count < MAX_MOVES_PER_GAME:
        # Get information state for current player
        info_state = get_info_state(state, current_player)

        # Check for legal moves
        legal = get_all_moves(info_state, current_player, abilities)
        if not legal:
            # No legal moves — extremely rare, skip turn
            current_player = 3 - current_player
            move_count += 1
            continue

        # Temperature: exploratory early, greedy late
        temperature = 1.0 if move_count < TEMP_THRESHOLD else 0.1

        # Run IS-MCTS
        policy, best_move = run_ismcts(
            info_state, current_player, abilities, network,
            num_simulations=MCTS_SIMULATIONS,
            num_determinizations=NUM_DETERMINIZATIONS,
            add_noise=True,
            temperature=temperature,
        )

        if best_move is None:
            # Fallback: random legal move
            import random
            best_move = random.choice(legal)

        # Store training sample (state from current player's perspective)
        state_tensor = encode_state(info_state, current_player, abilities)
        samples.append((state_tensor, policy, current_player))

        # Apply move to the TRUE state (not the info state)
        state = apply_move(state, best_move)
        current_player = 3 - current_player
        move_count += 1

        if verbose and move_count % 20 == 0:
            print(f"  move {move_count}: pieces={_count_str(state)}")

    winner = get_winner(state)

    if verbose:
        outcome = f"Player {winner} wins" if winner else "Draw/timeout"
        print(f"  Game over after {move_count} moves: {outcome}")

    return samples, winner, move_count


def samples_to_training_data(samples, winner):
    """Convert game samples to training data with value targets.

    Args:
        samples: list of (state_tensor, policy, player) from play_game
        winner: winning player (1/2) or 0 for draw

    Returns:
        states: (N, H, W, C) float32
        policies: (N, 972) float32
        values: (N, 1) float32 — +1 if player won, -1 if lost, 0 if draw
    """
    if not samples:
        return None, None, None

    states = []
    policies = []
    values = []

    for state_tensor, policy, player in samples:
        states.append(state_tensor)
        policies.append(policy)
        if winner == 0:
            values.append(0.0)
        elif winner == player:
            values.append(1.0)
        else:
            values.append(-1.0)

    return (
        np.array(states, dtype=np.float32),
        np.array(policies, dtype=np.float32),
        np.array(values, dtype=np.float32).reshape(-1, 1),
    )


def generate_self_play_data(network, num_games, abilities=DEFAULT_ABILITIES,
                            verbose=False):
    """Generate training data from multiple self-play games.

    Returns:
        all_states, all_policies, all_values: concatenated numpy arrays
        stats: dict with game statistics
    """
    all_states = []
    all_policies = []
    all_values = []
    wins = {0: 0, 1: 0, 2: 0}
    total_moves = 0
    start = time.time()

    for game_idx in range(num_games):
        game_start = time.time()
        samples, winner, num_moves = play_game(network, abilities, verbose=False)
        game_time = time.time() - game_start

        states, policies, values = samples_to_training_data(samples, winner)
        if states is not None:
            all_states.append(states)
            all_policies.append(policies)
            all_values.append(values)

        wins[winner] = wins.get(winner, 0) + 1
        total_moves += num_moves

        if verbose:
            outcome = f"P{winner} wins" if winner else "draw"
            print(f"  Game {game_idx + 1}/{num_games}: {outcome}, "
                  f"{num_moves} moves, {game_time:.1f}s")

    elapsed = time.time() - start

    if all_states:
        concat_states = np.concatenate(all_states)
        concat_policies = np.concatenate(all_policies)
        concat_values = np.concatenate(all_values)
    else:
        concat_states = np.zeros((0,), dtype=np.float32)
        concat_policies = np.zeros((0,), dtype=np.float32)
        concat_values = np.zeros((0,), dtype=np.float32)

    stats = {
        'num_games': num_games,
        'p1_wins': wins.get(1, 0),
        'p2_wins': wins.get(2, 0),
        'draws': wins.get(0, 0),
        'avg_moves': total_moves / max(1, num_games),
        'total_samples': len(concat_states),
        'elapsed_sec': elapsed,
    }

    return concat_states, concat_policies, concat_values, stats


def _count_str(state):
    """Quick piece count string for logging."""
    c = {1: 0, 2: 0}
    for r in range(6):
        for col in range(6):
            p = state.board[r][col]
            if p:
                c[p['player']] = c.get(p['player'], 0) + 1
    return f"P1={c[1]} P2={c[2]}"
