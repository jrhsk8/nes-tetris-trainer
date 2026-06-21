import sys, os, re, json
REPO_PY = '/home/dev/bt-spike/betatetris-tablebase/python'
sys.path.insert(0, REPO_PY); os.chdir(REPO_PY)
import numpy as np, torch, tetris
from model import Model, obs_to_torch
from compare import (our_to_board, board_to_key, metrics, is_tower, load_model,
                     best_placement, fresh, lines_for, PIECE_IDS)

ROWS, COLS = 20, 10
def render(key, label):
    print(f"  {label}: holes={metrics(key)['holes']} max={metrics(key)['max']} tower={is_tower(metrics(key))}")
    for r in range(ROWS):
        row = key[r*COLS:(r+1)*COLS]
        if row == '0'*COLS and all(key[rr*COLS:(rr+1)*COLS] == '0'*COLS for rr in range(r)):
            continue  # skip leading empty rows
        print("   " + row.replace('0', '.').replace('1', '#'))

results = json.load(open('/home/dev/bt-spike/results_perfect.json'))
# holes context
for grp in ['quarantine', 'current']:
    rs = [r for r in results if r.get('group') == grp and not r.get('skipped')]
    b0 = np.mean([r['board0']['holes'] for r in rs])
    opt = np.mean([r['our_optimal']['holes'] for r in rs if r['our_optimal']])
    hv = [x['holes_vs_board0'] for r in rs for x in r['per_next']]
    import collections
    dist = collections.Counter(hv)
    print(f"[{grp}] board0 holes mean {b0:.2f}, our-optimal holes mean {opt:.2f}; "
          f"BetaTetris holes_vs_board0 dist {dict(sorted(dist.items()))}")

sample = json.load(open('/home/dev/bt-spike/sample.json'))
byid = {p['id']: p for p in sample}
model = load_model('/home/dev/bt-spike/models/model-v1.0.0-perfect.pth')

# render one quarantine (our optimal towered) + one current
examples = []
for r in results:
    if r.get('skipped'): continue
    if r['group'] == 'quarantine' and r['our_optimal'] and r['our_optimal']['tower'] and 'q' not in [e[0] for e in examples]:
        examples.append(('q', r))
    if r['group'] == 'current' and 'c' not in [e[0] for e in examples]:
        examples.append(('c', r))
    if len(examples) >= 2 and any(e[0]=='q' for e in examples) and any(e[0]=='c' for e in examples):
        break

for tag, r in examples:
    pz = byid[r['id']]
    p1, p2 = pz['piece1'], pz['piece2']
    lines = lines_for(pz['board'])
    print(f"\n===== {tag} puzzle #{r['number']} group={r['group']} p1={p1} p2={p2} lines={lines} =====")
    render(pz['board'], 'board0')
    opt_key = pz['combos']['entries'][0]['boardKey']
    render(opt_key, 'OUR optimal (rank-1)')
    # BetaTetris 2-ply for next=p2 (representative) and next=I
    g = fresh(pz['board'], p1, p2, lines)
    place1, _ = best_placement(model, g)
    g.InputPlacement(*place1)
    for nxt in [PIECE_IDS.index('I'), PIECE_IDS.index(p2) if p2 in PIECE_IDS else 0]:
        g2 = fresh(pz['board'], p1, p2, lines)
        g2.InputPlacement(*place1)
        g2.SetNextPiece(nxt)
        place2, _ = best_placement(model, g2)
        g2.InputPlacement(*place2)
        render(board_to_key(g2.GetBoard()), f'BetaTetris 2-ply (place1={place1}, next={PIECE_IDS[nxt]}, place2={place2})')
