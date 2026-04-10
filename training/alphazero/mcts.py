"""
AlphaZero-style MCTS with neural network guidance.

Key differences from vanilla MCTS:
  - Policy prior from NN guides exploration (PUCT, not UCB1)
  - Value estimate from NN replaces rollouts / hand-crafted eval
  - Dirichlet noise at root for exploration during self-play
  - Information set handling via determinization (for hidden pieces)
"""
import math
import numpy as np
from .config import (
    MCTS_SIMULATIONS, NUM_DETERMINIZATIONS, CPUCT,
    DIRICHLET_ALPHA, DIRICHLET_EPSILON, ACTION_SPACE_SIZE,
)
from .game_engine import (
    get_all_moves, apply_move, is_terminal, get_winner,
    determinize, encode_state,
)
from .action_space import move_to_action, get_action_mask


class MCTSNode:
    """A node in the MCTS search tree."""
    __slots__ = [
        'state', 'player', 'abilities', 'parent', 'move', 'action_idx',
        'children', 'visit_count', 'value_sum', 'prior',
        '_legal_moves', '_expanded',
    ]

    def __init__(self, state, player, abilities, parent=None, move=None,
                 action_idx=-1, prior=0.0):
        self.state = state
        self.player = player
        self.abilities = abilities
        self.parent = parent
        self.move = move
        self.action_idx = action_idx
        self.children = []
        self.visit_count = 0
        self.value_sum = 0.0
        self.prior = prior
        self._legal_moves = None
        self._expanded = False

    @property
    def q_value(self):
        if self.visit_count == 0:
            return 0.0
        return self.value_sum / self.visit_count

    def is_terminal(self):
        return is_terminal(self.state)

    def legal_moves(self):
        if self._legal_moves is None:
            self._legal_moves = get_all_moves(self.state, self.player, self.abilities)
        return self._legal_moves

    def is_expanded(self):
        return self._expanded


def _select_child(node, cpuct):
    """Select the child with highest PUCT score.
    PUCT = Q(s,a) + c * P(s,a) * sqrt(N(s)) / (1 + N(s,a))

    Q is from the PARENT's perspective: we want the move that maximizes
    value for the player who is about to move (node.player).
    But child.value_sum is accumulated from the perspective of whoever
    evaluated the leaf. We store values from the ROOT player's perspective,
    so we flip the sign when the node's player differs from root.
    """
    sqrt_parent = math.sqrt(node.visit_count)
    best_score = -float('inf')
    best_child = None

    for child in node.children:
        if child.visit_count == 0:
            q = 0.0
        else:
            # child.value_sum is from root player's perspective
            # node.player is the one choosing — if node.player == root_player,
            # we want high Q; if node.player != root_player, we want low Q.
            # We handle this by always storing Q from child's parent's perspective
            # in the expand step, so here Q is directly usable.
            q = child.value_sum / child.visit_count

        exploration = cpuct * child.prior * sqrt_parent / (1 + child.visit_count)
        score = q + exploration

        if score > best_score:
            best_score = score
            best_child = child

    return best_child


def _expand(node, network, root_player):
    """Expand a node: get NN policy + value, create child nodes."""
    # Get state encoding from the current player's perspective
    state_tensor = encode_state(node.state, node.player, node.abilities)
    policy_logits, value = network.predict(state_tensor)

    # Value is from current player's perspective; convert to root's perspective
    if node.player != root_player:
        value = -value

    # Mask illegal actions and compute softmax
    legal = node.legal_moves()
    if not legal:
        # No moves — pass (shouldn't normally happen in Skillego)
        node._expanded = True
        return value

    mask, action_to_move = get_action_mask(legal)
    # Apply mask: set illegal actions to -inf before softmax
    masked_logits = np.where(mask > 0, policy_logits, -1e9)
    # Stable softmax
    max_logit = np.max(masked_logits)
    exp_logits = np.exp(masked_logits - max_logit)
    exp_logits = exp_logits * mask  # zero out illegal
    total = np.sum(exp_logits)
    if total > 0:
        priors = exp_logits / total
    else:
        # Fallback: uniform over legal moves
        priors = mask / np.sum(mask)

    # Create child nodes
    next_player = 3 - node.player  # toggle 1 ↔ 2
    for action_idx, m in action_to_move.items():
        child_state = apply_move(node.state, m)
        child = MCTSNode(
            state=child_state, player=next_player, abilities=node.abilities,
            parent=node, move=m, action_idx=action_idx,
            prior=priors[action_idx],
        )
        node.children.append(child)

    node._expanded = True
    return value


def _backpropagate(node, value):
    """Walk up the tree, updating visit counts and value sums.
    Value is from root player's perspective throughout."""
    while node is not None:
        node.visit_count += 1
        # Value is from root player's perspective.
        # If this node's player == root_player, a high value is good (we keep it).
        # If this node's player != root_player, a high value is bad (flip sign).
        # But we select children from the parent's perspective, so we need Q
        # to reflect the parent's utility. Store value as-is (root perspective)
        # and handle the flip in _select_child... actually, let's simplify:
        #
        # Standard approach: store value from ROOT player's perspective.
        # In _select_child, parent selects the child that maximizes value
        # for parent.player. If parent.player == root_player, pick highest Q.
        # If parent.player != root_player, pick lowest Q (best for opponent).
        node.value_sum += value
        node = node.parent


def run_mcts(state, player, abilities, network, num_simulations=MCTS_SIMULATIONS,
             cpuct=CPUCT, add_noise=True):
    """Run MCTS from the given state and return the root node.

    Args:
        state: GameState (should be determinized if hidden info exists)
        player: current player (1 or 2)
        abilities: set/frozenset of enabled ability IDs
        network: SkillZeroWrapper
        num_simulations: number of MCTS iterations
        cpuct: exploration constant
        add_noise: add Dirichlet noise at root (True during self-play)

    Returns:
        root MCTSNode with visit statistics
    """
    root_player = player
    root = MCTSNode(state, player, abilities)

    # Expand root
    _ = _expand(root, network, root_player)

    # Add Dirichlet noise to root priors for exploration
    if add_noise and root.children:
        noise = np.random.dirichlet([DIRICHLET_ALPHA] * len(root.children))
        for child, n in zip(root.children, noise):
            child.prior = (1 - DIRICHLET_EPSILON) * child.prior + DIRICHLET_EPSILON * n

    for _ in range(num_simulations):
        node = root

        # ── Selection: traverse tree using PUCT ────────────────────────
        while node.is_expanded() and not node.is_terminal() and node.children:
            # Flip PUCT sign for opponent nodes
            if node.player == root_player:
                node = _select_child(node, cpuct)
            else:
                # Opponent wants to minimize root's value
                # We select the child with lowest Q from root's perspective
                # Equivalently, negate Q in selection
                node = _select_child_opponent(node, cpuct)

        # ── Expansion + Evaluation ────────────────────────────────────
        if node.is_terminal():
            winner = get_winner(node.state)
            if winner == root_player:
                value = 1.0
            elif winner == 0:
                value = 0.0  # draw (shouldn't happen in Skillego)
            else:
                value = -1.0
        elif not node.is_expanded():
            value = _expand(node, network, root_player)
        else:
            # Expanded but no children (no legal moves) — treat as loss
            value = -1.0

        # ── Backpropagation ───────────────────────────────────────────
        _backpropagate(node, value)

    return root


def _select_child_opponent(node, cpuct):
    """Select child for the opponent (minimize root player's value)."""
    sqrt_parent = math.sqrt(node.visit_count)
    best_score = -float('inf')
    best_child = None

    for child in node.children:
        if child.visit_count == 0:
            q = 0.0
        else:
            # Negate Q: opponent wants low value for root player
            q = -(child.value_sum / child.visit_count)
        exploration = cpuct * child.prior * sqrt_parent / (1 + child.visit_count)
        score = q + exploration
        if score > best_score:
            best_score = score
            best_child = child

    return best_child


def get_policy_from_root(root, temperature=1.0):
    """Extract move probabilities from MCTS root visit counts.

    Args:
        root: MCTSNode (after search)
        temperature: controls exploration.
            1.0 = proportional to visit counts (exploratory)
            0.0 = argmax (greedy, for competitive play)

    Returns:
        policy: (972,) probability distribution over action space
        best_move: the selected move dict
    """
    policy = np.zeros(ACTION_SPACE_SIZE, dtype=np.float32)

    if not root.children:
        return policy, None

    if temperature < 1e-6:
        # Greedy: pick the most-visited child
        best = max(root.children, key=lambda c: c.visit_count)
        policy[best.action_idx] = 1.0
        return policy, best.move

    # Temperature-scaled visit counts
    visits = np.array([c.visit_count for c in root.children], dtype=np.float64)
    actions = [c.action_idx for c in root.children]

    if temperature == 1.0:
        probs = visits / visits.sum()
    else:
        log_visits = np.log(visits + 1e-8)
        scaled = log_visits / temperature
        scaled -= scaled.max()
        exp_scaled = np.exp(scaled)
        probs = exp_scaled / exp_scaled.sum()

    for action_idx, prob in zip(actions, probs):
        policy[action_idx] = prob

    # Sample a move
    chosen_idx = np.random.choice(len(root.children), p=probs)
    best_move = root.children[chosen_idx].move

    return policy, best_move


def run_ismcts(state, player, abilities, network,
               num_simulations=MCTS_SIMULATIONS,
               num_determinizations=NUM_DETERMINIZATIONS,
               cpuct=CPUCT, add_noise=True, temperature=1.0):
    """Information Set MCTS: run multiple determinizations and aggregate.

    This is the main entry point for move selection with hidden information.

    Returns:
        policy: (972,) aggregated probability distribution
        best_move: selected move
    """
    # Check if determinization is needed
    has_hidden = any(
        state.covered[r][c] and state.board[r][c] is not None
        and state.board[r][c]['player'] != player
        for r in range(6) for c in range(6)
    )

    actual_det = 1 if not has_hidden else num_determinizations
    actual_sims = num_simulations

    # Aggregate visit counts across determinizations
    total_visits = {}  # action_idx → total visits
    action_to_move = {}

    for _ in range(actual_det):
        det_state = determinize(state, player) if has_hidden else state
        root = run_mcts(det_state, player, abilities, network,
                        actual_sims, cpuct, add_noise)

        for child in root.children:
            a = child.action_idx
            total_visits[a] = total_visits.get(a, 0) + child.visit_count
            if a not in action_to_move:
                action_to_move[a] = child.move

    # Build aggregated policy
    policy = np.zeros(ACTION_SPACE_SIZE, dtype=np.float32)
    if not total_visits:
        return policy, None

    if temperature < 1e-6:
        best_a = max(total_visits, key=total_visits.get)
        policy[best_a] = 1.0
        return policy, action_to_move[best_a]

    # Temperature-scaled visit distribution
    actions = list(total_visits.keys())
    visits = np.array([total_visits[a] for a in actions], dtype=np.float64)

    if temperature == 1.0:
        probs = visits / visits.sum()
    else:
        log_v = np.log(visits + 1e-8)
        scaled = log_v / temperature
        scaled -= scaled.max()
        exp_s = np.exp(scaled)
        probs = exp_s / exp_s.sum()

    for a, prob in zip(actions, probs):
        policy[a] = prob

    # Sample
    chosen_idx = np.random.choice(len(actions), p=probs)
    best_move = action_to_move[actions[chosen_idx]]

    return policy, best_move
