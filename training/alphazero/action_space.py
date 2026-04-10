"""
Action space encoding for Skillego AlphaZero.

Maps between move dicts (used by the game engine) and action indices
(used by the neural network policy head).

27 planes × 36 cells = 972 total actions.
See config.py for plane layout.
"""
import numpy as np
from .config import (
    BOARD_COLS, NUM_CELLS, ACTION_SPACE_SIZE, DIR_TO_IDX,
    PLANE_MOVE, PLANE_UNCOVER, PLANE_HOP, PLANE_PUSH,
    PLANE_ENGULF, PLANE_TRANSFORM_LINE, PLANE_TRANSFORM_EXPLODE,
    PLANE_SNIPE, PLANE_PYRO,
)


def _cell_idx(r, c):
    return r * BOARD_COLS + c


def move_to_action(move):
    """Convert a move dict → action index (0..971)."""
    mt = move['type']

    if mt in ('move', 'capture'):
        fr, fc = move['from_r'], move['from_c']
        tr, tc = move['to_r'], move['to_c']
        d = (tr - fr, tc - fc)
        plane = PLANE_MOVE + DIR_TO_IDX[d]
        return plane * NUM_CELLS + _cell_idx(fr, fc)

    if mt == 'uncover':
        return PLANE_UNCOVER * NUM_CELLS + _cell_idx(move['r'], move['c'])

    if mt == 'hop':
        fr, fc = move['from_r'], move['from_c']
        tr, tc = move['to_r'], move['to_c']
        d = ((tr - fr) // 2, (tc - fc) // 2)
        plane = PLANE_HOP + DIR_TO_IDX[d]
        return plane * NUM_CELLS + _cell_idx(fr, fc)

    if mt == 'push':
        dr_r, dr_c = move['dr_r'], move['dr_c']
        er, ec = move['enemy_r'], move['enemy_c']
        d = (er - dr_r, ec - dr_c)
        plane = PLANE_PUSH + DIR_TO_IDX[d]
        return plane * NUM_CELLS + _cell_idx(dr_r, dr_c)

    if mt == 'engulf':
        return PLANE_ENGULF * NUM_CELLS + _cell_idx(move['r'], move['c'])

    if mt == 'transform':
        wr, wc = move['wiz_r'], move['wiz_c']
        if move['is_explosion']:
            return PLANE_TRANSFORM_EXPLODE * NUM_CELLS + _cell_idx(wr, wc)
        # Line: direction from wizard to first extension cell
        cr, cc = move['cells'][1]
        d = (cr - wr, cc - wc)
        plane = PLANE_TRANSFORM_LINE + DIR_TO_IDX[d]
        return plane * NUM_CELLS + _cell_idx(wr, wc)

    if mt == 'snipe':
        rr, rc = move['robot_r'], move['robot_c']
        tr, tc = move['target_r'], move['target_c']
        dr = 0 if tr == rr else (1 if tr > rr else -1)
        dc = 0 if tc == rc else (1 if tc > rc else -1)
        plane = PLANE_SNIPE + DIR_TO_IDX[(dr, dc)]
        return plane * NUM_CELLS + _cell_idx(rr, rc)

    if mt == 'pyro':
        fr, fc = move['from_r'], move['from_c']
        tr, tc = move['target_r'], move['target_c']
        d = (tr - fr, tc - fc)
        plane = PLANE_PYRO + DIR_TO_IDX[d]
        return plane * NUM_CELLS + _cell_idx(fr, fc)

    raise ValueError(f"Unknown move type: {mt}")


def get_action_mask(legal_moves):
    """Return a binary mask over the action space for the given legal moves.
    Also returns the action-to-move mapping for those actions."""
    mask = np.zeros(ACTION_SPACE_SIZE, dtype=np.float32)
    action_to_move = {}
    for m in legal_moves:
        a = move_to_action(m)
        mask[a] = 1.0
        action_to_move[a] = m
    return mask, action_to_move


def policy_to_moves(policy_probs, legal_moves):
    """Extract move probabilities from a policy vector.
    Returns list of (move, probability) sorted by probability desc."""
    result = []
    for m in legal_moves:
        a = move_to_action(m)
        result.append((m, policy_probs[a]))
    result.sort(key=lambda x: x[1], reverse=True)
    return result
