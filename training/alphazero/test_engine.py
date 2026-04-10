"""Quick verification tests for game engine correctness."""
import sys
sys.path.insert(0, r'C:\EpicSource\web\skillegoAI\backend')

from alphazero.game_engine import *
from alphazero.action_space import move_to_action
from alphazero.config import DEFAULT_ABILITIES

abilities = DEFAULT_ABILITIES
errors = []

# Test 1: Mouse captures Dragon
s = GameState()
s.board[2][2] = make_piece('mouse', 1, 1)
s.board[2][3] = make_piece('dragon', 6, 2)
mvs = get_valid_moves(s, 2, 2)
if (2, 3) in mvs:
    print('PASS: Mouse can capture Dragon')
else:
    errors.append('FAIL: Mouse cannot capture Dragon')

# Test 2: Dragon cannot capture Mouse
s = GameState()
s.board[2][2] = make_piece('dragon', 6, 1)
s.board[2][3] = make_piece('mouse', 1, 2)
mvs = get_valid_moves(s, 2, 2)
if (2, 3) not in mvs:
    print('PASS: Dragon cannot capture Mouse')
else:
    errors.append('FAIL: Dragon CAN capture Mouse')

# Test 3: Burning Dragon CAN capture Mouse
s = GameState()
s.board[2][2] = make_piece('dragon', 6, 1, burning=True)
s.board[2][3] = make_piece('mouse', 1, 2)
mvs = get_valid_moves(s, 2, 2)
if (2, 3) in mvs:
    print('PASS: Burning Dragon captures Mouse')
else:
    errors.append('FAIL: Burning Dragon cannot capture Mouse')

# Test 4: Push
s = GameState()
s.board[2][2] = make_piece('dragon', 6, 1)
s.board[2][3] = make_piece('cat', 2, 2)
push_mvs = get_push_moves(s, 2, 2, abilities)
if len(push_mvs) == 1 and push_mvs[0]['dest_r'] == 2 and push_mvs[0]['dest_c'] == 4:
    ns = apply_move(s, push_mvs[0])
    if ns.board[2][4] is not None and ns.board[2][4]['type'] == 'cat':
        print('PASS: Push moves enemy')
    else:
        errors.append('FAIL: Push did not move enemy')
else:
    errors.append(f'FAIL: Push moves wrong: {push_mvs}')

# Test 5: Hop
s = GameState()
s.board[3][3] = make_piece('mouse', 1, 1)
s.board[2][3] = make_piece('dog', 3, 2)
hop_mvs = get_hop_moves(s, 3, 3, abilities)
found = any(m['to_r'] == 1 and m['to_c'] == 3 for m in hop_mvs)
if found:
    print('PASS: Mouse can hop')
else:
    errors.append(f'FAIL: Hop not found, got {hop_mvs}')

# Test 6: Engulf
s = GameState()
s.board[2][2] = make_piece('dragon', 6, 1)
eng = get_engulf_moves(s, 2, 2, abilities)
if len(eng) == 1:
    ns = apply_move(s, eng[0])
    if ns.board[2][2]['burning']:
        print('PASS: Dragon can engulf')
    else:
        errors.append('FAIL: Engulf did not set burning')
else:
    errors.append('FAIL: No engulf move')

# Test 7: Transform Line
s = GameState()
s.board[3][0] = make_piece('wizard', 4, 1)
t_mvs = get_transform_moves(s, 3, 0, abilities)
line_mvs = [m for m in t_mvs if not m['is_explosion']]
if len(line_mvs) > 0:
    m = line_mvs[0]
    ns = apply_move(s, m)
    mice_count = sum(1 for r in range(6) for c in range(6)
                     if ns.board[r][c] and ns.board[r][c]['type'] == 'mouse')
    if mice_count == 4:
        print('PASS: Transform line creates 4 mice')
    else:
        errors.append(f'FAIL: Transform created {mice_count} mice')
else:
    errors.append('FAIL: No line transform')

# Test 8: Transform Explode
s = GameState()
s.board[3][3] = make_piece('wizard', 4, 1)
t_mvs = get_transform_moves(s, 3, 3, abilities)
expl = [m for m in t_mvs if m['is_explosion']]
if len(expl) == 1:
    ns = apply_move(s, expl[0])
    if ns.board[3][3] is None:
        mice = sum(1 for r in range(6) for c in range(6)
                   if ns.board[r][c] and ns.board[r][c]['type'] == 'mouse')
        if mice == 4:
            print('PASS: Transform explode (wizard vanishes, 4 mice)')
        else:
            errors.append(f'FAIL: Explosion created {mice} mice')
    else:
        errors.append('FAIL: Wizard did not vanish')
else:
    errors.append(f'FAIL: No explosion transform')

# Test 9: Snipe
s = GameState()
s.board[0][0] = make_piece('robot', 5, 1)
s.board[0][3] = make_piece('dog', 3, 2)
s.board[1][3] = make_piece('cat', 2, 1)
snipe_mvs = get_snipe_moves(s, 0, 0, abilities)
if len(snipe_mvs) == 1:
    ns = apply_move(s, snipe_mvs[0])
    if ns.board[0][3] is not None and ns.board[0][3]['type'] == 'robot':
        print('PASS: Robot snipe works')
    else:
        errors.append('FAIL: Snipe did not move robot')
else:
    errors.append(f'FAIL: Snipe moves: {len(snipe_mvs)}')

# Test 10: Pyro
s = GameState()
s.board[2][2] = make_piece('dragon', 6, 1, burning=True)
s.board[2][3] = make_piece('dog', 3, 2)
pyro_mvs = get_pyro_moves(s, 2, 2, abilities)
if len(pyro_mvs) >= 1:
    ns = apply_move(s, pyro_mvs[0])
    target = ns.board[2][3]
    burner = ns.board[2][2]
    if target and target['burning'] and (burner is None or burner['power'] == 5):
        print('PASS: Pyro spreads fire and costs burner 1 power')
    else:
        errors.append(f'FAIL: Pyro state wrong: target={target}, burner={burner}')
else:
    errors.append('FAIL: No pyro moves')

# Test 11: Burning move costs power
s = GameState()
s.board[2][2] = make_piece('dragon', 6, 1, burning=True)
ns = apply_move(s, {'type': 'move', 'from_r': 2, 'from_c': 2, 'to_r': 2, 'to_c': 3})
p = ns.board[2][3]
if p and p['power'] == 5 and p['type'] == 'robot':
    print('PASS: Burning move reduces power and changes type')
else:
    errors.append(f'FAIL: Burning move result: {p}')

# Test 12: Action encoding
test_moves = [
    {'type': 'move', 'from_r': 2, 'from_c': 3, 'to_r': 1, 'to_c': 3},
    {'type': 'capture', 'from_r': 0, 'from_c': 0, 'to_r': 0, 'to_c': 1, 'cap_power': 3},
    {'type': 'uncover', 'r': 5, 'c': 5},
    {'type': 'hop', 'from_r': 3, 'from_c': 3, 'to_r': 1, 'to_c': 3},
    {'type': 'push', 'dr_r': 2, 'dr_c': 2, 'enemy_r': 2, 'enemy_c': 3, 'dest_r': 2, 'dest_c': 4},
    {'type': 'engulf', 'r': 3, 'c': 3},
    {'type': 'transform', 'wiz_r': 2, 'wiz_c': 0, 'cells': [(2,0),(2,1),(2,2),(2,3)], 'is_explosion': False},
    {'type': 'transform', 'wiz_r': 3, 'wiz_c': 3, 'cells': [(2,3),(3,4),(4,3),(3,2)], 'is_explosion': True},
    {'type': 'snipe', 'robot_r': 0, 'robot_c': 0, 'target_r': 0, 'target_c': 4, 'spotter_r': 1, 'spotter_c': 4},
    {'type': 'pyro', 'from_r': 2, 'from_c': 2, 'target_r': 2, 'target_c': 3},
]
actions = [move_to_action(m) for m in test_moves]
all_unique = len(set(actions)) == len(test_moves)
all_valid = all(0 <= a < 972 for a in actions)
if all_unique and all_valid:
    print('PASS: All move types encode to unique valid action indices')
else:
    errors.append('FAIL: Action encoding collision or out of range')

# Test 13: Full game random playthrough
import random
random.seed(42)
state = create_initial_state()
player = 1
for i in range(100):
    mvs = get_all_moves(state, player, abilities)
    if not mvs or is_terminal(state):
        break
    state = apply_move(state, random.choice(mvs))
    player = 3 - player

counts = count_pieces(state)
print(f'PASS: 100-move random game completed (P1={counts.get(1,0)}, P2={counts.get(2,0)})')

# Summary
print(f'\n{"=" * 40}')
if errors:
    for e in errors:
        print(e)
    print(f'FAILED: {len(errors)} test(s)')
else:
    print('ALL 13 TESTS PASSED')
