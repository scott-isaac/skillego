"""
Complete Skillego game engine — faithful port of JS rules.js.
All 6 piece types, all 6 abilities, burning mechanics.
Pure functions: no globals, no side effects, no DOM.
"""
import random
import numpy as np
from .config import (
    BOARD_ROWS, BOARD_COLS, PIECES, BURN_LEVEL, TYPE_TO_IDX,
    DIRS, NUM_INPUT_CHANNELS, ABILITY_IDS,
)


def in_bounds(r, c):
    return 0 <= r < BOARD_ROWS and 0 <= c < BOARD_COLS


def make_piece(piece_type, power, player, burning=False):
    return {'type': piece_type, 'power': power, 'player': player, 'burning': burning}


# ── Capture Rules (matches JS canCapture exactly) ─────────────────────────

def can_capture(attacker, defender):
    if attacker['player'] == defender['player']:
        return False
    # Burning immunity: immune to mice only while power > 1
    if defender['burning'] and defender['power'] > 1 and attacker['type'] == 'mouse':
        return False
    # Burning offense: burning piece always captures mice
    if attacker['burning'] and defender['type'] == 'mouse':
        return True
    # Dragon cannot normally capture mice
    if defender['type'] == 'mouse' and attacker['type'] == 'dragon':
        return False
    if attacker['power'] >= defender['power']:
        return True
    # Mouse special: captures dragon
    if attacker['type'] == 'mouse' and defender['type'] == 'dragon':
        return True
    return False


# ── Game State ─────────────────────────────────────────────────────────────

class GameState:
    """Immutable-ish game state: board[r][c] = piece dict | None, covered[r][c] = bool."""
    __slots__ = ['board', 'covered']

    def __init__(self, board=None, covered=None):
        if board is None:
            self.board = [[None] * BOARD_COLS for _ in range(BOARD_ROWS)]
            self.covered = [[False] * BOARD_COLS for _ in range(BOARD_ROWS)]
        else:
            self.board = board
            self.covered = covered

    def clone(self):
        board = []
        covered = []
        for r in range(BOARD_ROWS):
            b_row = [None] * BOARD_COLS
            c_row = [False] * BOARD_COLS
            for c in range(BOARD_COLS):
                p = self.board[r][c]
                if p is not None:
                    b_row[c] = p.copy()  # shallow copy of dict — fine for flat dicts
                c_row[c] = self.covered[r][c]
            board.append(b_row)
            covered.append(c_row)
        return GameState(board, covered)


def create_initial_state():
    """Random piece placement, all covered."""
    pieces = []
    for player in (1, 2):
        for pdef in PIECES:
            for _ in range(pdef['quantity']):
                pieces.append(make_piece(pdef['type'], pdef['power'], player))
    random.shuffle(pieces)

    state = GameState()
    idx = 0
    for r in range(BOARD_ROWS):
        for c in range(BOARD_COLS):
            state.board[r][c] = pieces[idx]
            state.covered[r][c] = True
            idx += 1
    return state


# ── Standard Move Generation ──────────────────────────────────────────────

def get_valid_moves(state, r, c):
    """Orthogonal moves/captures for the uncovered piece at (r, c)."""
    piece = state.board[r][c]
    if piece is None or state.covered[r][c]:
        return []
    result = []
    for dr, dc in DIRS:
        nr, nc = r + dr, c + dc
        if not in_bounds(nr, nc):
            continue
        target = state.board[nr][nc]
        if target is None:
            result.append((nr, nc))
        elif not state.covered[nr][nc] and can_capture(piece, target):
            result.append((nr, nc))
    return result


# ── Ability Move Generation ───────────────────────────────────────────────

def get_push_moves(state, r, c, abilities):
    if 'push' not in abilities:
        return []
    piece = state.board[r][c]
    if piece is None or piece['burning'] or piece['type'] != 'dragon':
        return []
    result = []
    for dr, dc in DIRS:
        er, ec = r + dr, c + dc
        dest_r, dest_c = r + 2 * dr, c + 2 * dc
        if not in_bounds(er, ec) or not in_bounds(dest_r, dest_c):
            continue
        enemy = state.board[er][ec]
        if enemy is None or enemy['player'] == piece['player'] or state.covered[er][ec]:
            continue
        if state.board[dest_r][dest_c] is not None:
            continue
        result.append({
            'type': 'push', 'dr_r': r, 'dr_c': c,
            'enemy_r': er, 'enemy_c': ec,
            'dest_r': dest_r, 'dest_c': dest_c,
        })
    return result


def get_hop_moves(state, r, c, abilities):
    if 'hop' not in abilities:
        return []
    piece = state.board[r][c]
    if piece is None or piece['burning'] or piece['type'] != 'mouse':
        return []
    result = []
    for dr, dc in DIRS:
        mid_r, mid_c = r + dr, c + dc
        land_r, land_c = r + 2 * dr, c + 2 * dc
        if not in_bounds(mid_r, mid_c) or not in_bounds(land_r, land_c):
            continue
        if state.board[mid_r][mid_c] is None:
            continue
        if state.board[land_r][land_c] is not None:
            continue
        result.append({
            'type': 'hop', 'from_r': r, 'from_c': c,
            'to_r': land_r, 'to_c': land_c,
        })
    return result


def get_engulf_moves(state, r, c, abilities):
    if 'engulf' not in abilities:
        return []
    piece = state.board[r][c]
    if piece is None or piece['burning'] or piece['type'] != 'dragon':
        return []
    return [{'type': 'engulf', 'r': r, 'c': c}]


def get_transform_moves(state, r, c, abilities):
    if 'transform' not in abilities:
        return []
    piece = state.board[r][c]
    if piece is None or piece['burning'] or piece['type'] != 'wizard':
        return []
    result = []

    # Line: wizard cell + 3 extending cells (extension cells must be empty)
    for dr, dc in DIRS:
        cells = [(r, c)]
        valid = True
        for step in range(1, 4):
            cr, cc = r + step * dr, c + step * dc
            if not in_bounds(cr, cc) or state.board[cr][cc] is not None:
                valid = False
                break
            cells.append((cr, cc))
        if valid:
            result.append({
                'type': 'transform', 'wiz_r': r, 'wiz_c': c,
                'cells': cells, 'is_explosion': False,
            })

    # Explosion: all 4 surrounding cells must be in-bounds and empty
    explode_cells = [(r + dr, c + dc) for dr, dc in DIRS]
    if all(in_bounds(cr, cc) and state.board[cr][cc] is None
           for cr, cc in explode_cells):
        result.append({
            'type': 'transform', 'wiz_r': r, 'wiz_c': c,
            'cells': explode_cells, 'is_explosion': True,
        })
    return result


def get_snipe_moves(state, r, c, abilities):
    if 'snipe' not in abilities:
        return []
    piece = state.board[r][c]
    if piece is None or piece['burning'] or piece['type'] != 'robot':
        return []
    result = []
    for dr, dc in DIRS:
        # Walk along direction to find first blocking piece
        tr, tc = r + dr, c + dc
        target_r, target_c = -1, -1
        while in_bounds(tr, tc):
            if state.board[tr][tc] is not None:
                target_r, target_c = tr, tc
                break
            tr += dr
            tc += dc
        if target_r == -1:
            continue
        target = state.board[target_r][target_c]
        if target['player'] == piece['player'] or state.covered[target_r][target_c]:
            continue
        # Find a friendly non-burning cat adjacent to the target
        spotter_r, spotter_c = -1, -1
        for ar, ac in DIRS:
            cr, cc = target_r + ar, target_c + ac
            if not in_bounds(cr, cc):
                continue
            cat = state.board[cr][cc]
            if (cat is not None and cat['type'] == 'cat'
                    and cat['player'] == piece['player']
                    and not cat['burning'] and not state.covered[cr][cc]):
                spotter_r, spotter_c = cr, cc
                break
        if spotter_r != -1:
            result.append({
                'type': 'snipe', 'robot_r': r, 'robot_c': c,
                'target_r': target_r, 'target_c': target_c,
                'spotter_r': spotter_r, 'spotter_c': spotter_c,
            })
    return result


def get_pyro_moves(state, r, c, abilities):
    if 'pyromania' not in abilities:
        return []
    piece = state.board[r][c]
    if piece is None or not piece['burning']:
        return []
    result = []
    for dr, dc in DIRS:
        tr, tc = r + dr, c + dc
        if not in_bounds(tr, tc):
            continue
        target = state.board[tr][tc]
        if (target is None or target['player'] == piece['player']
                or target['burning'] or state.covered[tr][tc]):
            continue
        result.append({
            'type': 'pyro', 'from_r': r, 'from_c': c,
            'target_r': tr, 'target_c': tc,
        })
    return result


# ── All Legal Moves ───────────────────────────────────────────────────────

def get_all_moves(state, player, abilities):
    """All legal moves for *player*. Captures first (by power desc), then
    ability/regular moves, then uncovers — same priority as the JS MCTS."""
    captures = []
    moves = []
    uncovers = []

    for r in range(BOARD_ROWS):
        for c in range(BOARD_COLS):
            piece = state.board[r][c]
            if piece is None:
                continue

            # Any covered cell can be uncovered by either player
            if state.covered[r][c]:
                uncovers.append({'type': 'uncover', 'r': r, 'c': c})
                continue

            if piece['player'] != player:
                continue

            # Standard moves / captures
            for nr, nc in get_valid_moves(state, r, c):
                target = state.board[nr][nc]
                if target is not None:
                    captures.append({
                        'type': 'capture', 'from_r': r, 'from_c': c,
                        'to_r': nr, 'to_c': nc, 'cap_power': target['power'],
                    })
                else:
                    moves.append({
                        'type': 'move', 'from_r': r, 'from_c': c,
                        'to_r': nr, 'to_c': nc,
                    })

            # Push
            for m in get_push_moves(state, r, c, abilities):
                moves.append(m)
            # Hop
            for m in get_hop_moves(state, r, c, abilities):
                moves.append(m)
            # Engulf — only if nearby enemy mouse (matches JS MCTS filter)
            for m in get_engulf_moves(state, r, c, abilities):
                nearby = False
                for mr in range(BOARD_ROWS):
                    for mc in range(BOARD_COLS):
                        t = state.board[mr][mc]
                        if (t and t['type'] == 'mouse' and t['player'] != player
                                and not state.covered[mr][mc]
                                and abs(mr - r) + abs(mc - c) <= 2):
                            nearby = True
                            break
                    if nearby:
                        break
                if nearby:
                    moves.append(m)
            # Snipe (counts as capture)
            for m in get_snipe_moves(state, r, c, abilities):
                captures.append(m)
            # Pyro
            for m in get_pyro_moves(state, r, c, abilities):
                moves.append(m)
            # Transform
            for m in get_transform_moves(state, r, c, abilities):
                moves.append(m)

    captures.sort(key=lambda m: m.get('cap_power', 0), reverse=True)
    return captures + moves + uncovers


# ── Apply Move (returns NEW state, never mutates input) ───────────────────

def apply_move(state, move):
    s = state.clone()
    mt = move['type']

    if mt == 'uncover':
        s.covered[move['r']][move['c']] = False

    elif mt in ('move', 'capture'):
        fr, fc = move['from_r'], move['from_c']
        tr, tc = move['to_r'], move['to_c']
        piece = s.board[fr][fc]
        s.board[tr][tc] = piece
        s.board[fr][fc] = None
        s.covered[tr][tc] = False
        if piece['burning']:
            piece['power'] -= 1
            if piece['power'] <= 0:
                s.board[tr][tc] = None
            else:
                piece['type'] = BURN_LEVEL[piece['power']]

    elif mt == 'hop':
        fr, fc = move['from_r'], move['from_c']
        tr, tc = move['to_r'], move['to_c']
        s.board[tr][tc] = s.board[fr][fc]
        s.board[fr][fc] = None
        s.covered[tr][tc] = False

    elif mt == 'push':
        er, ec = move['enemy_r'], move['enemy_c']
        dr, dc = move['dest_r'], move['dest_c']
        s.board[dr][dc] = s.board[er][ec]
        s.covered[dr][dc] = False
        s.board[er][ec] = None

    elif mt == 'engulf':
        r, c = move['r'], move['c']
        s.board[r][c]['burning'] = True

    elif mt == 'transform':
        wr, wc = move['wiz_r'], move['wiz_c']
        player = s.board[wr][wc]['player']
        s.board[wr][wc] = None
        s.covered[wr][wc] = False
        for cr, cc in move['cells']:
            if in_bounds(cr, cc) and s.board[cr][cc] is None:
                s.board[cr][cc] = make_piece('mouse', 1, player)
                s.covered[cr][cc] = False

    elif mt == 'snipe':
        rr, rc = move['robot_r'], move['robot_c']
        tr, tc = move['target_r'], move['target_c']
        s.board[tr][tc] = s.board[rr][rc]
        s.covered[tr][tc] = False
        s.board[rr][rc] = None

    elif mt == 'pyro':
        fr, fc = move['from_r'], move['from_c']
        tr, tc = move['target_r'], move['target_c']
        burner = s.board[fr][fc]
        s.board[tr][tc]['burning'] = True
        burner['power'] -= 1
        if burner['power'] <= 0:
            s.board[fr][fc] = None
        else:
            burner['type'] = BURN_LEVEL[burner['power']]

    return s


# ── Terminal Detection ────────────────────────────────────────────────────

def count_pieces(state):
    """Return {player: total_piece_count}."""
    counts = {}
    for r in range(BOARD_ROWS):
        for c in range(BOARD_COLS):
            p = state.board[r][c]
            if p is not None:
                counts[p['player']] = counts.get(p['player'], 0) + 1
    return counts


def get_winner(state):
    """Return winning player (1 or 2), or 0 if game is not over."""
    counts = count_pieces(state)
    if counts.get(1, 0) == 0 and counts.get(2, 0) > 0:
        return 2
    if counts.get(2, 0) == 0 and counts.get(1, 0) > 0:
        return 1
    return 0


def is_terminal(state):
    return get_winner(state) != 0


# ── Determinization ───────────────────────────────────────────────────────

def determinize(state, perspective_player):
    """Fill opponent's covered cells with random consistent piece assignments.
    The perspective player already knows their own covered pieces."""
    s = state.clone()
    opponent = 3 - perspective_player

    # Collect opponent covered cells and figure out what's unaccounted for
    opp_covered_cells = []
    seen_opp_types = []

    for r in range(BOARD_ROWS):
        for c in range(BOARD_COLS):
            p = s.board[r][c]
            if p is None:
                continue
            if s.covered[r][c] and p['player'] == opponent:
                opp_covered_cells.append((r, c))
            elif not s.covered[r][c] and p['player'] == opponent:
                seen_opp_types.append(p['type'])

    if not opp_covered_cells:
        return s

    # Build pool of unaccounted opponent pieces
    remaining = {}
    for pdef in PIECES:
        remaining[pdef['type']] = pdef['quantity']
    for t in seen_opp_types:
        remaining[t] -= 1

    pool = []
    for pdef in PIECES:
        for _ in range(max(0, remaining[pdef['type']])):
            pool.append(make_piece(pdef['type'], pdef['power'], opponent))

    random.shuffle(pool)

    for i, (r, c) in enumerate(opp_covered_cells):
        if i < len(pool):
            s.board[r][c] = pool[i]
        else:
            # More covered cells than pool — some were captured already
            s.board[r][c] = None
            s.covered[r][c] = False

    return s


# ── State Encoding for Neural Network ────────────────────────────────────

def encode_state(state, perspective_player, abilities):
    """Encode state as (H, W, C) float32 tensor for TF (channels-last).

    24 channels — see config.py for the full breakdown.
    """
    tensor = np.zeros((BOARD_ROWS, BOARD_COLS, NUM_INPUT_CHANNELS), dtype=np.float32)
    opponent = 3 - perspective_player

    for r in range(BOARD_ROWS):
        for c in range(BOARD_COLS):
            piece = state.board[r][c]
            if piece is None:
                tensor[r, c, 14] = 1.0  # empty
                continue

            if piece['player'] == perspective_player:
                # Own piece — we know type even if covered
                idx = TYPE_TO_IDX[piece['type']]
                tensor[r, c, idx] = 1.0
                if state.covered[r][c]:
                    tensor[r, c, 12] = 1.0  # own covered
                if piece['burning']:
                    tensor[r, c, 15] = piece['power'] / 6.0
            else:
                # Opponent piece
                if state.covered[r][c]:
                    tensor[r, c, 13] = 1.0  # opponent covered (identity unknown)
                else:
                    idx = TYPE_TO_IDX[piece['type']] + 6
                    tensor[r, c, idx] = 1.0
                    if piece['burning']:
                        tensor[r, c, 16] = piece['power'] / 6.0

    # Bias plane
    tensor[:, :, 17] = 1.0

    # Ability flags (planes 18-23)
    for i, ability_id in enumerate(ABILITY_IDS):
        if ability_id in abilities:
            tensor[:, :, 18 + i] = 1.0

    return tensor


# ── Masked State for Perspective ──────────────────────────────────────────

def get_info_state(state, perspective_player):
    """Return a view of the state from perspective_player's point of view.
    Own covered pieces keep their identity; opponent covered pieces are
    replaced with unknown placeholders (player is kept, type/power zeroed).
    This is what the NN and MCTS should operate on."""
    s = state.clone()
    opponent = 3 - perspective_player
    for r in range(BOARD_ROWS):
        for c in range(BOARD_COLS):
            p = s.board[r][c]
            if p is not None and p['player'] == opponent and s.covered[r][c]:
                # Replace with unknown placeholder — keeps player and position
                s.board[r][c] = {'type': 'unknown', 'power': 0,
                                 'player': opponent, 'burning': False}
    return s
