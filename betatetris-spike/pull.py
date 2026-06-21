"""Pull a sample from Supabase for the BetaTetris cross-check spike.
13 previously-quarantined puzzles (old bad rank-1s) + 20 deterministic-random
current puzzles. Writes ~/bt-spike/sample.json. Reads creds from the WSL repo's
.sandcastle/.env (never printed)."""
import json, os, sys

# Output dir (sandcastle bakes BT_HOME; WSL `~/bt-spike` is the fallback).
BT_HOME = os.environ.get('BT_HOME', '/home/dev/bt-spike')
BT_OUT = os.environ.get('BT_OUT', BT_HOME)
ENV_PATH = os.environ.get('BT_ENV_FILE', '/home/dev/nes-tetris-trainer/.sandcastle/.env')

def load_env(path):
    env = {}
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                v = v.strip().strip('"').strip("'")
                env[k.strip()] = v
    except FileNotFoundError:
        pass
    return env

# In sandcastle the creds are already in the process env; fall back to the .env file.
dsn = os.environ.get('DATABASE_URL') or load_env(ENV_PATH).get('DATABASE_URL')
if not dsn:
    print('NO DATABASE_URL', file=sys.stderr); sys.exit(1)

import psycopg

COLS_CURRENT = "id, number, board, piece1, piece2, optimal_line, optimal_metrics, combos"
COLS_QUAR = "id, board, piece1, piece2, optimal_line, combos"

out = []
with psycopg.connect(dsn, connect_timeout=20) as conn:
    with conn.cursor() as cur:
        # quarantine (old bad rank-1s); number column may not exist there
        try:
            cur.execute(f"select {COLS_QUAR} from puzzles_quarantine_20260621")
            for row in cur.fetchall():
                d = dict(zip(["id", "board", "piece1", "piece2", "optimal_line", "combos"], row))
                d["id"] = str(d["id"]); d["number"] = None; d["group"] = "quarantine"
                out.append(d)
        except Exception as e:
            print("quarantine pull failed:", e, file=sys.stderr)
        # current bank: deterministic-random 20 via md5(id)
        cur.execute(
            f"select {COLS_CURRENT} from public.puzzles order by md5(id::text) limit 20")
        for row in cur.fetchall():
            d = dict(zip(["id", "number", "board", "piece1", "piece2",
                          "optimal_line", "optimal_metrics", "combos"], row))
            d["id"] = str(d["id"]); d["group"] = "current"
            out.append(d)

os.makedirs(BT_OUT, exist_ok=True)
with open(os.path.join(BT_OUT, 'sample.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f)

nq = sum(1 for d in out if d["group"] == "quarantine")
nc = sum(1 for d in out if d["group"] == "current")
print(f"pulled {len(out)} puzzles: {nq} quarantine + {nc} current")
# sanity print of one row's shape
if out:
    s = out[0]
    print("sample keys:", sorted(s.keys()))
    print("board len:", len(s["board"]), "piece1:", s["piece1"], "piece2:", s["piece2"])
    print("optimal_line:", s["optimal_line"])
    combos = s["combos"]
    ents = (combos or {}).get("entries", []) if isinstance(combos, dict) else []
    print("combos total:", (combos or {}).get("total"), "entries:", len(ents))
    if ents:
        print("rank1 entry:", {k: ents[0][k] for k in ents[0] if k != 'boardKey'},
              "boardKey_len", len(ents[0].get("boardKey", "")))
