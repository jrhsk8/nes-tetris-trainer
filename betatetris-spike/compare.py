"""BetaTetris cross-check harness (spike).

For each sampled puzzle: inject board0, take BetaTetris's piece-1 placement
(next=piece2), then sweep piece-2 over all 7 possible next pieces. Encode each
resulting board, compare to our stored optimal + top-K combos, and characterise
towers / hole-burying with the #50 audit metric. Runs the perfect + normal nets.
Writes results_<model>.json and prints a summary."""
import sys, os, re, json, time
REPO_PY = '/home/dev/bt-spike/betatetris-tablebase/python'
sys.path.insert(0, REPO_PY)
os.chdir(REPO_PY)
import numpy as np, torch
import tetris
from model import Model, obs_to_torch

ROWS, COLS = 20, 10
PIECE_IDS = ['T', 'J', 'Z', 'O', 'S', 'L', 'I']  # BetaTetris id order (ParsePieceID)

def our_to_board(s):
    chars = np.frombuffer(s.encode(), dtype=np.uint8)
    filled = (chars == ord('1')).astype(np.uint8).reshape(ROWS, COLS)
    return tetris.Board((1 - filled).astype(np.uint8))  # their convention: 1=empty

def board_to_key(b):
    # str(b) prints only rows from the first non-empty down to row 19, each as
    # "<row-index> <10 cells>" (empty top rows omitted). Place by printed index.
    rows = ['0' * COLS] * ROWS
    for line in str(b).rstrip('\n').split('\n'):
        if not line.strip():
            continue
        r = int(line.split()[0])
        cells = line[-COLS:]
        rows[r] = ''.join('1' if ch == 'X' else '0' for ch in cells)
    return ''.join(rows)

def metrics(key):  # verbatim from the #50 audit (diag.py)
    filled = [[key[r * COLS + c] != '0' for c in range(COLS)] for r in range(ROWS)]
    col_h = [0] * COLS; holes = 0
    for c in range(COLS):
        top = None
        for r in range(ROWS):
            if filled[r][c]: top = r; break
        if top is None: col_h[c] = 0
        else:
            col_h[c] = ROWS - top
            for r in range(top + 1, ROWS):
                if not filled[r][c]: holes += 1
    bump = sum(abs(col_h[c] - col_h[c + 1]) for c in range(COLS - 1))
    return {"holes": holes, "max": max(col_h), "agg": sum(col_h), "bump": bump, "col_h": col_h}

def is_tower(m):  # diag.py "spike" definition
    ch = sorted(m["col_h"], reverse=True)
    return ch[0] >= 12 and ch[0] - ch[1] >= 5

def load_model(path):
    sd = torch.load(path, weights_only=True, map_location='cpu')
    channels = sd['main_start.0.main.0.weight'].shape[0]
    sb = len([k for k in sd if re.fullmatch(r'main_start.*main\.0\.weight', k)])
    eb = len([k for k in sd if re.fullmatch(r'main_end.*main\.0\.weight', k)])
    m = Model(sb, eb, channels); m.load_state_dict(sd); m.eval()
    return m

def best_placement(model, g):
    with torch.no_grad():
        pi, v = model(obs_to_torch(g.GetState()))
    a = int(torch.argmax(pi, 1).item())
    return (a // 200, a // 10 % 20, a % 10), float(v[1].item())

def lines_for(board_str):
    # Engine requires (10*lines + filled) % 4 == 0 (NES cell-count parity).
    # lines 0 or 1 both keep us at level 18. Odd filled = not a legal NES board.
    m = board_str.count('1') % 4
    if m == 0: return 0
    if m == 2: return 1
    return None

def fresh(board0_str, p1, p2, lines):
    g = tetris.Tetris()
    g.Reset(p1, p2, lines=lines, board=our_to_board(board0_str), adj_delay=18, aggression_level=0)
    return g

def two_ply(model, board0_str, p1, p2, lines):
    g = fresh(board0_str, p1, p2, lines)
    inject_ok = (board_to_key(g.GetBoard()) == board0_str)
    place1, v1 = best_placement(model, g)
    g.InputPlacement(*place1)
    board1_key = board_to_key(g.GetBoard())
    res = {"place1": place1, "v1": round(v1, 4), "inject_ok": inject_ok,
           "board1_metrics": metrics(board1_key), "topped1": bool(g.IsOver()), "nexts": []}
    for p3 in range(7):
        g2 = fresh(board0_str, p1, p2, lines)
        g2.InputPlacement(*place1)
        g2.SetNextPiece(p3)
        place2, v2 = best_placement(model, g2)
        g2.InputPlacement(*place2)
        rk = board_to_key(g2.GetBoard())
        res["nexts"].append({"p3": PIECE_IDS[p3], "place2": place2, "v2": round(v2, 4),
                             "key": rk, "metrics": metrics(rk), "topped": bool(g2.IsOver())})
    return res

def run(mname, mpath, sample):
    t0 = time.time()
    model = load_model(mpath)
    results = []
    for i, pz in enumerate(sample):
        combos = pz.get("combos") or {}
        entries = combos.get("entries", []) if isinstance(combos, dict) else []
        opt_key = entries[0]["boardKey"] if entries else None
        keyrank = {e["boardKey"]: idx for idx, e in enumerate(entries) if e.get("boardKey")}
        opt_m = metrics(opt_key) if opt_key else None
        b0m = metrics(pz["board"])
        lines = lines_for(pz["board"])
        if lines is None:
            results.append({"id": pz["id"], "number": pz["number"], "group": pz["group"],
                            "skipped": "odd-filled-not-legal-nes", "board0": {"holes": b0m["holes"], "max": b0m["max"]},
                            "per_next": []})
            print(f"  [{mname}] {i+1}/{len(sample)} SKIP odd-parity", flush=True)
            continue
        tp = two_ply(model, pz["board"], pz["piece1"], pz["piece2"], lines)
        per_next = []
        for nx in tp["nexts"]:
            m = nx["metrics"]
            per_next.append({
                "p3": nx["p3"], "match_optimal": (nx["key"] == opt_key),
                "matched_rank": keyrank.get(nx["key"]),
                "holes": m["holes"], "max": m["max"], "tower": is_tower(m),
                "holes_vs_board0": m["holes"] - b0m["holes"], "topped": nx["topped"]})
        results.append({
            "id": pz["id"], "number": pz["number"], "group": pz["group"],
            "p1": pz["piece1"], "p2": pz["piece2"], "inject_ok": tp["inject_ok"],
            "board0": {"holes": b0m["holes"], "max": b0m["max"]},
            "our_optimal": ({"holes": opt_m["holes"], "max": opt_m["max"], "tower": is_tower(opt_m)}
                            if opt_m else None),
            "bt_agree_optimal_of7": sum(x["match_optimal"] for x in per_next),
            "bt_in_topK_of7": sum(x["matched_rank"] is not None for x in per_next),
            "bt_tower_of7": sum(x["tower"] for x in per_next),
            "bt_holebury_of7": sum(x["holes_vs_board0"] > 0 for x in per_next),
            "bt_holes_range": [min(x["holes"] for x in per_next), max(x["holes"] for x in per_next)],
            "bt_max_range": [min(x["max"] for x in per_next), max(x["max"] for x in per_next)],
            "per_next": per_next})
        print(f"  [{mname}] {i+1}/{len(sample)} done", flush=True)
    json.dump(results, open(f'/home/dev/bt-spike/results_{mname}.json', 'w'))
    summarize(results, mname)
    print(f"[{mname}] elapsed {int(time.time()-t0)}s", flush=True)
    return results

def summarize(results, mname):
    skipped = [r for r in results if r.get("skipped")]
    live = [r for r in results if not r.get("skipped")]
    inj = sum(r["inject_ok"] for r in live)
    print(f"\n==== SUMMARY [{mname}] inject_ok {inj}/{len(live)}  skipped(odd-parity) {len(skipped)} ====")
    for grp in ["quarantine", "current", "ALL"]:
        rs = [r for r in live if grp == "ALL" or r["group"] == grp]
        if not rs: continue
        n = len(rs)
        opt_tower = sum(1 for r in rs if r["our_optimal"] and r["our_optimal"]["tower"])
        picks = [x for r in rs for x in r["per_next"]]
        npk = len(picks)
        bt_tower = sum(x["tower"] for x in picks)
        bt_bury = sum(x["holes_vs_board0"] > 0 for x in picks)
        bt_top = sum(x["topped"] for x in picks)
        holes_mean = sum(x["holes"] for x in picks) / npk
        max_mean = sum(x["max"] for x in picks) / npk
        agree_any = sum(1 for r in rs if r["bt_agree_optimal_of7"] > 0)
        agree_maj = sum(1 for r in rs if r["bt_agree_optimal_of7"] >= 4)
        topk_any = sum(1 for r in rs if r["bt_in_topK_of7"] > 0)
        print(f"[{mname}/{grp}] n={n}  picks={npk}(={n}x7)")
        print(f"   our optimal towers (sanity): {opt_tower}/{n}")
        print(f"   BetaTetris tower: {bt_tower} ({100*bt_tower/npk:.0f}%)  holebury: {bt_bury} ({100*bt_bury/npk:.0f}%)  topped-out: {bt_top}")
        print(f"   BetaTetris holes mean {holes_mean:.2f}  maxheight mean {max_mean:.1f}")
        print(f"   agree-our-optimal: any-of-7 {agree_any}/{n}  majority>=4/7 {agree_maj}/{n}  lands-in-topK(any) {topk_any}/{n}")

if __name__ == "__main__":
    sample = json.load(open('/home/dev/bt-spike/sample.json'))
    MODELS = {"perfect": "/home/dev/bt-spike/models/model-v1.0.0-perfect.pth",
              "normal": "/home/dev/bt-spike/models/model-v1.0.0-normal.pth"}
    for mname, mpath in MODELS.items():
        run(mname, mpath, sample)
