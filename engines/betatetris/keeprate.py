"""#54 Phase 1 — measure the BetaTetris consensus keep-rate.

For each bank puzzle we ask: does BetaTetris's *piece-1 policy* seriously
consider our stored optimal's piece-1 placement? We inject board0, read the
policy logits over all piece-1 placements, simulate each *legal* action to its
resulting board, and accumulate policy mass per distinct outcome board (so two
rotation encodings that land the same cells share their mass). Our optimal's
after-piece-1 outcome key (`p1_key`, computed by `generator/src/bt-bank-keys.ts`
in the production convention) is then looked up in that ranked distribution.

This is convention-free: both sides match by the 200-char outcome key, never by
rotation/col numbers. We report, per model and overall, the fraction of puzzles
where our optimal is BetaTetris's top-1 / in top-3 / in top-5 / reachable, plus
the mean policy mass π_BT(optimal). Those are the candidate keep-rates the #54
Phase-2 gate would use. Offline / generator-only (GPLv3 BetaTetris).

  bt-run python engines/betatetris/keeprate.py            # full bank
  bt-run python engines/betatetris/keeprate.py 40         # first 40 (quick)
"""
import sys, os, re, json, time
BT_HOME = os.environ.get('BT_HOME', '/home/dev/bt-spike')
REPO_PY = os.environ.get('BT_REPO_PY', os.path.join(BT_HOME, 'betatetris-tablebase', 'python'))
BT_MODELS = os.environ.get('BT_MODELS', os.path.join(BT_HOME, 'models'))
BT_OUT = os.environ.get('BT_OUT') or BT_HOME
sys.path.insert(0, REPO_PY)
os.chdir(REPO_PY)
import numpy as np, torch
import tetris
from model import Model, obs_to_torch

ROWS, COLS = 20, 10

def our_to_board(s):
    chars = np.frombuffer(s.encode(), dtype=np.uint8)
    filled = (chars == ord('1')).astype(np.uint8).reshape(ROWS, COLS)
    return tetris.Board((1 - filled).astype(np.uint8))  # their convention: 1=empty

def board_to_key(b):
    rows = ['0' * COLS] * ROWS
    for line in str(b).rstrip('\n').split('\n'):
        if not line.strip():
            continue
        r = int(line.split()[0])
        cells = line[-COLS:]
        rows[r] = ''.join('1' if ch == 'X' else '0' for ch in cells)
    return ''.join(rows)

def load_model(path):
    sd = torch.load(path, weights_only=True, map_location='cpu')
    channels = sd['main_start.0.main.0.weight'].shape[0]
    sb = len([k for k in sd if re.fullmatch(r'main_start.*main\.0\.weight', k)])
    eb = len([k for k in sd if re.fullmatch(r'main_end.*main\.0\.weight', k)])
    m = Model(sb, eb, channels); m.load_state_dict(sd); m.eval()
    return m

def lines_for(board_str):
    m = board_str.count('1') % 4
    if m == 0: return 0
    if m == 2: return 1
    return None

def fresh(board0_str, p1, p2, lines):
    g = tetris.Tetris()
    g.Reset(p1, p2, lines=lines, board=our_to_board(board0_str), adj_delay=18, aggression_level=0)
    return g

def policy_logits(model, g):
    with torch.no_grad():
        pi, _v = model(obs_to_torch(g.GetState()))
    return pi[0].cpu().numpy()  # shape [800]; invalid actions are -inf

def decode(a):
    return (a // 200, a // 10 % 20, a % 10)

def piece1_outcome_distribution(model, board0_str, p1, p2, lines):
    """Map each distinct after-piece-1 outcome key -> total policy mass.

    BetaTetris places a piece in two NES phases: a (here forced) pre-adjustment
    tap, then the *adjustment* decision that actually locks the piece. We read the
    policy at whichever phase chooses the FINAL placement: take the argmax; if it
    is a pre-adjustment move (`IsAdjMove`), apply it and re-read the policy. The
    resulting distribution is over real piece-1 outcomes. Returns (dist,
    inject_ok) with dist = {outcome_key: policy mass}, summing to ~1."""
    g = fresh(board0_str, p1, p2, lines)
    inject_ok = (board_to_key(g.GetBoard()) == board0_str)
    logits = policy_logits(model, g)
    finite = [a for a in range(logits.shape[0]) if np.isfinite(logits[a])]
    best = max(finite, key=lambda a: logits[a])
    premove = decode(best) if g.IsAdjMove(*decode(best)) else None
    if premove is not None:
        g.InputPlacement(*premove)  # enter the adjustment phase (does not lock)
        logits = policy_logits(model, g)
        finite = [a for a in range(logits.shape[0]) if np.isfinite(logits[a])]
    lv = np.array([logits[a] for a in finite], dtype=np.float64)
    lv -= lv.max()
    p = np.exp(lv); p /= p.sum()
    dist = {}
    for a, prob in zip(finite, p):
        g2 = fresh(board0_str, p1, p2, lines)
        if premove is not None:
            g2.InputPlacement(*premove)
        g2.InputPlacement(*decode(a))
        key = board_to_key(g2.GetBoard())
        dist[key] = dist.get(key, 0.0) + float(prob)
    return dist, inject_ok

def rank_of(dist, key):
    """1-indexed rank of `key` by descending policy mass; None if unreachable."""
    if key not in dist:
        return None
    order = sorted(dist.values(), reverse=True)
    # rank = (# strictly greater) + 1
    target = dist[key]
    return sum(1 for v in dist.values() if v > target + 1e-12) + 1

def run(mname, mpath, bank):
    t0 = time.time()
    model = load_model(mpath)
    rows = []
    for i, pz in enumerate(bank):
        lines = lines_for(pz['board'])
        if lines is None:
            rows.append({'number': pz['number'], 'skipped': 'odd-parity'})
            print(f"  [{mname}] {i+1}/{len(bank)} SKIP odd-parity", flush=True)
            continue
        dist, inject_ok = piece1_outcome_distribution(
            model, pz['board'], pz['piece1'], pz['piece2'], lines)
        key = pz['p1_key']
        rank = rank_of(dist, key)
        rows.append({
            'number': pz['number'], 'id': pz['id'],
            'piece1': pz['piece1'], 'piece2': pz['piece2'],
            'accept_count': pz.get('accept_count'),
            'inject_ok': inject_ok,
            'pi_optimal': round(dist.get(key, 0.0), 6),
            'rank': rank, 'n_outcomes': len(dist),
        })
        print(f"  [{mname}] {i+1}/{len(bank)} #{pz['number']} "
              f"pi={dist.get(key,0.0):.3f} rank={rank}/{len(dist)} inj={inject_ok}", flush=True)
    json.dump(rows, open(os.path.join(BT_OUT, f'keeprate_{mname}.json'), 'w'))
    summarize(rows, mname)
    print(f"[{mname}] elapsed {int(time.time()-t0)}s", flush=True)
    return rows

def summarize(rows, mname):
    live = [r for r in rows if not r.get('skipped')]
    n = len(live)
    skipped = len(rows) - n
    inj_bad = sum(1 for r in live if not r['inject_ok'])
    if not n:
        print(f"\n==== KEEP-RATE [{mname}] no live puzzles ===="); return
    reach = sum(1 for r in live if r['rank'] is not None)
    top1 = sum(1 for r in live if r['rank'] == 1)
    top3 = sum(1 for r in live if r['rank'] is not None and r['rank'] <= 3)
    top5 = sum(1 for r in live if r['rank'] is not None and r['rank'] <= 5)
    pi_mean = sum(r['pi_optimal'] for r in live) / n
    pi_reach_mean = (sum(r['pi_optimal'] for r in live if r['rank'] is not None) / reach) if reach else 0.0
    pct = lambda k: f"{k}/{n} ({100*k/n:.0f}%)"
    print(f"\n==== KEEP-RATE [{mname}] n={n} live (skipped odd-parity {skipped}, inject mismatches {inj_bad}) ====")
    print(f"   our optimal is BetaTetris TOP-1 (exact consensus): {pct(top1)}")
    print(f"   our optimal in BetaTetris TOP-3:                    {pct(top3)}")
    print(f"   our optimal in BetaTetris TOP-5:                    {pct(top5)}")
    print(f"   our optimal reachable / considered at all:          {pct(reach)}")
    print(f"   mean policy mass pi_BT(optimal): all={pi_mean:.3f}  when-reachable={pi_reach_mean:.3f}")
    # keep-rate at a few pi thresholds (the Phase-2 gate would pick one)
    for thr in (0.01, 0.05, 0.10, 0.20):
        k = sum(1 for r in live if r['pi_optimal'] >= thr)
        print(f"   keep if pi_BT(optimal) >= {thr:.2f}: {pct(k)}")

if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    bank = json.load(open(os.path.join(BT_OUT, 'bank_keys.json')))
    if limit:
        bank = bank[:limit]
    print(f"measuring keep-rate over {len(bank)} puzzles", flush=True)
    MODELS = {"perfect": os.path.join(BT_MODELS, 'model-v1.0.0-perfect.pth'),
              "normal": os.path.join(BT_MODELS, 'model-v1.0.0-normal.pth')}
    for mname, mpath in MODELS.items():
        run(mname, mpath, bank)
