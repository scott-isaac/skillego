"""
AlphaZero training loop for Skillego.

Usage:
    cd C:\\EpicSource\\web\\skillego\\training
    .venv\\Scripts\\python.exe -u -m alphazero.train [--iterations N] [--games N] [--resume PATH]
    (or just run train.bat)

Each iteration:
  1. Warmup (first iter only): heuristic games to bootstrap the NN
  2. Self-play: generate games using current model + MCTS
  3. Train: update network on accumulated replay buffer
  4. Evaluate: pit new model against previous champion
  5. If new model wins enough, promote it to champion
"""
import os
import sys
import time
import argparse
import json
import numpy as np
from collections import deque

# Ensure parent dir is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alphazero.config import (
    SELF_PLAY_GAMES, TRAINING_ITERATIONS, BATCH_SIZE,
    LEARNING_RATE, LR_SCHEDULE, WEIGHT_DECAY,
    REPLAY_BUFFER_SIZE, MIN_BUFFER_SIZE, EPOCHS_PER_ITERATION,
    EVAL_GAMES, WIN_THRESHOLD, CHECKPOINT_FREQ,
    DEFAULT_ABILITIES, ACTION_SPACE_SIZE,
    NUM_RES_BLOCKS, NUM_FILTERS,
)
from alphazero.network import SkillZeroWrapper, build_network
from alphazero.self_play import generate_self_play_data, play_game
from alphazero.heuristic import generate_warmup_data


class ReplayBuffer:
    """Fixed-size FIFO replay buffer for training samples."""

    def __init__(self, max_size=REPLAY_BUFFER_SIZE):
        self.states = deque(maxlen=max_size)
        self.policies = deque(maxlen=max_size)
        self.values = deque(maxlen=max_size)

    def add(self, states, policies, values):
        for s, p, v in zip(states, policies, values):
            self.states.append(s)
            self.policies.append(p)
            self.values.append(v)

    def sample(self, batch_size):
        indices = np.random.choice(len(self.states), size=batch_size, replace=False)
        return (
            np.array([self.states[i] for i in indices]),
            np.array([self.policies[i] for i in indices]),
            np.array([self.values[i] for i in indices]),
        )

    def __len__(self):
        return len(self.states)


def train_on_buffer(network, replay_buffer, epochs, batch_size, lr):
    """Train the network on the replay buffer."""
    import tensorflow as tf

    optimizer = tf.keras.optimizers.Adam(learning_rate=lr)
    model = network.model
    n = len(replay_buffer)

    total_loss = 0
    total_policy_loss = 0
    total_value_loss = 0
    num_batches = 0

    for epoch in range(epochs):
        # Shuffle indices for this epoch
        indices = np.random.permutation(n)
        for start in range(0, n - batch_size + 1, batch_size):
            batch_idx = indices[start:start + batch_size]
            states = np.array([replay_buffer.states[i] for i in batch_idx])
            target_policies = np.array([replay_buffer.policies[i] for i in batch_idx])
            target_values = np.array([replay_buffer.values[i] for i in batch_idx])

            with tf.GradientTape() as tape:
                policy_logits, pred_values = model(states, training=True)

                # Policy loss: cross-entropy with MCTS visit distribution
                # target_policies is a probability distribution (sums to ~1)
                policy_loss = tf.reduce_mean(
                    tf.nn.softmax_cross_entropy_with_logits(
                        labels=target_policies, logits=policy_logits
                    )
                )

                # Value loss: MSE
                value_loss = tf.reduce_mean(
                    tf.square(tf.squeeze(pred_values) - tf.squeeze(target_values))
                )

                # L2 regularization
                l2_loss = WEIGHT_DECAY * sum(
                    tf.nn.l2_loss(v) for v in model.trainable_variables
                    if 'bias' not in v.name and 'batch_normalization' not in v.name
                )

                loss = policy_loss + value_loss + l2_loss

            grads = tape.gradient(loss, model.trainable_variables)
            optimizer.apply_gradients(zip(grads, model.trainable_variables))

            total_loss += loss.numpy()
            total_policy_loss += policy_loss.numpy()
            total_value_loss += value_loss.numpy()
            num_batches += 1

    if num_batches == 0:
        return {'loss': 0, 'policy_loss': 0, 'value_loss': 0}

    return {
        'loss': total_loss / num_batches,
        'policy_loss': total_policy_loss / num_batches,
        'value_loss': total_value_loss / num_batches,
    }


def evaluate(challenger, champion, num_games=EVAL_GAMES, abilities=DEFAULT_ABILITIES):
    """Play games between challenger and champion.
    Returns challenger's win rate."""
    wins = {1: 0, 2: 0, 0: 0}

    for game_idx in range(num_games):
        # Alternate who goes first
        if game_idx % 2 == 0:
            challenger_player = 1
        else:
            challenger_player = 2

        from alphazero.game_engine import (
            create_initial_state, get_all_moves, apply_move,
            is_terminal, get_winner, encode_state, get_info_state,
        )
        from alphazero.mcts import run_ismcts
        import random

        state = create_initial_state()
        current_player = 1
        move_count = 0

        while not is_terminal(state) and move_count < MAX_MOVES_PER_GAME:
            info_state = get_info_state(state, current_player)
            legal = get_all_moves(info_state, current_player, abilities)
            if not legal:
                current_player = 3 - current_player
                move_count += 1
                continue

            # Choose which network to use
            net = challenger if current_player == challenger_player else champion

            _, best_move = run_ismcts(
                info_state, current_player, abilities, net,
                num_simulations=100,  # fewer sims for eval speed
                num_determinizations=4,
                add_noise=False,      # no exploration noise during eval
                temperature=0.1,      # near-greedy
            )

            if best_move is None:
                best_move = random.choice(legal)

            state = apply_move(state, best_move)
            current_player = 3 - current_player
            move_count += 1

        winner = get_winner(state)
        if winner == challenger_player:
            wins[1] += 1  # challenger wins
        elif winner == (3 - challenger_player):
            wins[2] += 1  # champion wins
        else:
            wins[0] += 1  # draw

    challenger_wins = wins[1]
    total_decisive = wins[1] + wins[2]
    if total_decisive == 0:
        return 0.5
    return challenger_wins / total_decisive


# Import here to avoid circular at module level
from alphazero.config import MAX_MOVES_PER_GAME


def main():
    parser = argparse.ArgumentParser(description='SkillZero Training')
    parser.add_argument('--iterations', type=int, default=TRAINING_ITERATIONS)
    parser.add_argument('--games', type=int, default=SELF_PLAY_GAMES)
    parser.add_argument('--resume', type=str, default=None,
                        help='Path to checkpoint to resume from')
    parser.add_argument('--no-eval', action='store_true',
                        help='Skip evaluation (faster iterations)')
    parser.add_argument('--warmup-games', type=int, default=500,
                        help='Heuristic warmup games for bootstrap (default: 500)')
    parser.add_argument('--skip-warmup', action='store_true',
                        help='Skip heuristic warmup (for resume)')
    args = parser.parse_args()

    # Setup output directory
    training_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(training_dir, 'models')
    os.makedirs(out_dir, exist_ok=True)
    log_path = os.path.join(out_dir, 'training_log.jsonl')

    print("=" * 60)
    print("SkillZero Training")
    print(f"  Iterations: {args.iterations}")
    print(f"  Self-play games/iter: {args.games}")
    print(f"  Warmup games: {args.warmup_games}")
    print(f"  Output: {out_dir}")
    print("=" * 60)

    # Initialize or load model
    if args.resume:
        print(f"Resuming from {args.resume}")
        network = SkillZeroWrapper.load(args.resume)
    else:
        print("Initializing fresh network...")
        network = SkillZeroWrapper(num_res_blocks=NUM_RES_BLOCKS, filters=NUM_FILTERS)

    # Champion: the best model so far
    champion = SkillZeroWrapper(num_res_blocks=NUM_RES_BLOCKS, filters=NUM_FILTERS)
    network.copy_weights_to(champion)

    replay_buffer = ReplayBuffer()
    best_iteration = 0

    # ── Warmup Phase ──────────────────────────────────────────────────
    if not args.resume and not args.skip_warmup:
        print(f"\n{'=' * 60}")
        print(f"Phase 0: Heuristic Warmup ({args.warmup_games} games)")
        print(f"{'=' * 60}")
        print("Generating training data from heuristic games...", flush=True)
        wu_states, wu_policies, wu_values, wu_stats = generate_warmup_data(
            args.warmup_games, verbose=True,
        )
        print(f"\nWarmup results: P1={wu_stats['p1_wins']}W "
              f"P2={wu_stats['p2_wins']}W D={wu_stats['draws']} | "
              f"avg {wu_stats['avg_moves']:.0f} moves | "
              f"{wu_stats['total_samples']} samples | "
              f"{wu_stats['elapsed_sec']:.1f}s", flush=True)

        if len(wu_states) > 0:
            replay_buffer.add(wu_states, wu_policies, wu_values)

            # Pre-train on warmup data
            print(f"\nPre-training on {len(replay_buffer)} warmup samples...", flush=True)
            warmup_lr = LEARNING_RATE * 2  # higher LR for warmup
            train_stats = train_on_buffer(
                network, replay_buffer, epochs=20, batch_size=BATCH_SIZE, lr=warmup_lr,
            )
            print(f"  Warmup loss: {train_stats['loss']:.4f} "
                  f"(policy={train_stats['policy_loss']:.4f}, "
                  f"value={train_stats['value_loss']:.4f})", flush=True)

            # Update champion with warmup-trained weights
            network.copy_weights_to(champion)
            champion.save(os.path.join(out_dir, 'warmup_champion.keras'))
            print("  Warmup champion saved.", flush=True)

    print(f"\n{'=' * 60}")
    print("Phase 1: AlphaZero Self-Play Training")
    print(f"{'=' * 60}")

    for iteration in range(1, args.iterations + 1):
        iter_start = time.time()
        print(f"\n{'-' * 60}")
        print(f"Iteration {iteration}/{args.iterations}")
        print(f"{'-' * 60}")

        # ── 1. Self-play ──────────────────────────────────────────────
        print(f"\n[Self-play] Generating {args.games} games...")
        sp_start = time.time()
        states, policies, values, stats = generate_self_play_data(
            network, args.games, verbose=True,
        )
        sp_time = time.time() - sp_start

        print(f"  Results: P1={stats['p1_wins']}W P2={stats['p2_wins']}W "
              f"D={stats['draws']} | avg {stats['avg_moves']:.0f} moves | "
              f"{stats['total_samples']} samples | {sp_time:.1f}s")

        if len(states) > 0:
            replay_buffer.add(states, policies, values)
        print(f"  Replay buffer: {len(replay_buffer)} samples")

        # ── 2. Training ───────────────────────────────────────────────
        if len(replay_buffer) < MIN_BUFFER_SIZE:
            print(f"\n[Training] Buffer too small ({len(replay_buffer)} < "
                  f"{MIN_BUFFER_SIZE}), skipping training")
            continue

        # Adjust learning rate
        lr = LEARNING_RATE
        for threshold, new_lr in sorted(LR_SCHEDULE.items()):
            if iteration >= threshold:
                lr = new_lr

        print(f"\n[Training] {EPOCHS_PER_ITERATION} epochs, "
              f"batch_size={BATCH_SIZE}, lr={lr}")
        train_start = time.time()
        train_stats = train_on_buffer(
            network, replay_buffer, EPOCHS_PER_ITERATION, BATCH_SIZE, lr,
        )
        train_time = time.time() - train_start

        print(f"  Loss: {train_stats['loss']:.4f} "
              f"(policy={train_stats['policy_loss']:.4f}, "
              f"value={train_stats['value_loss']:.4f}) | {train_time:.1f}s")

        # ── 3. Evaluation ─────────────────────────────────────────────
        if not args.no_eval and iteration % 2 == 0:
            print(f"\n[Evaluation] Challenger vs Champion ({EVAL_GAMES} games)...")
            eval_start = time.time()
            win_rate = evaluate(network, champion, num_games=EVAL_GAMES)
            eval_time = time.time() - eval_start

            print(f"  Win rate: {win_rate:.1%} | {eval_time:.1f}s")

            if win_rate >= WIN_THRESHOLD:
                print(f"  >>> New champion! (iteration {iteration})")
                network.copy_weights_to(champion)
                best_iteration = iteration
                champion.save(os.path.join(out_dir, 'champion.keras'))
            else:
                print(f"  Champion holds (best: iteration {best_iteration})")
        else:
            win_rate = None

        # ── 4. Checkpoint ─────────────────────────────────────────────
        if iteration % CHECKPOINT_FREQ == 0:
            ckpt_path = os.path.join(out_dir, f'checkpoint_iter{iteration}.keras')
            network.save(ckpt_path)
            print(f"  Saved checkpoint: {ckpt_path}")

        iter_time = time.time() - iter_start
        print(f"\n  Iteration {iteration} completed in {iter_time:.1f}s")

        # Log
        log_entry = {
            'iteration': iteration,
            'self_play': stats,
            'training': train_stats if len(replay_buffer) >= MIN_BUFFER_SIZE else None,
            'win_rate': win_rate,
            'champion_updated': win_rate is not None and win_rate >= WIN_THRESHOLD,
            'replay_buffer_size': len(replay_buffer),
            'lr': lr,
            'iter_time_sec': iter_time,
        }
        with open(log_path, 'a') as f:
            f.write(json.dumps(log_entry) + '\n')

    # Save final model
    final_path = os.path.join(out_dir, 'final.keras')
    network.save(final_path)
    print(f"\nTraining complete. Final model saved to {final_path}")
    print(f"Champion model at {os.path.join(out_dir, 'champion.keras')}")


if __name__ == '__main__':
    main()
