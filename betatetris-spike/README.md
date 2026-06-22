# betatetris-spike (BetaTetris cross-check adapters)

Adapter scripts for the BetaTetris cross-check — born as a feasibility spike, now also
the harness for the **#54 true-consensus filter**. They depend on the external GPLv3
repo `BetaTetris/betatetris-tablebase` + a CPU PyTorch env, both kept **offline /
generator-only** (per the engine-offline guardrail) — never linked into the play app.
Verdict and analysis: `../docs/decisions.md` (2026-06-21 — *Consensus bank* and *BetaTetris baked into the sandcastle image*).

## Where the engine lives (paths are env-driven)

The scripts read these env vars, defaulting to the WSL `~/bt-spike` supervised layout:

| var | sandcastle image | WSL fallback |
|---|---|---|
| `BT_HOME` | `/home/agent/betatetris` | `/home/dev/bt-spike` |
| `BT_REPO_PY` | `…/betatetris-tablebase/python` | derived from `BT_HOME` |
| `BT_MODELS` | `…/models` (perfect + normal `.pth`) | derived from `BT_HOME` |
| `BT_OUT` | `BT_HOME` (sample.json, results_*.json) | `BT_HOME` |
| `BT_ENV_FILE` | unused — creds are in the process env | `…/.sandcastle/.env` |

**In sandcastle** (the engine + env are baked into the image by `.sandcastle/Dockerfile`):
run inside the `bt` env via the `bt-run` wrapper — e.g. `bt-run python betatetris-spike/pull.py`
then `bt-run python betatetris-spike/compare.py`. `DATABASE_URL` is already in the env.

## Files
- `keeprate.py` — **#54 Phase-1 keep-rate harness** (the current one). Reads
  `bank_keys.json` (written by `generator/src/bt-bank-keys.ts`), injects each board0,
  and ranks our stored optimal's after-piece-1 outcome in BetaTetris's *adjustment-phase*
  policy → `keeprate_{perfect,normal}.json` + a top-1/3/5 / `π_BT` keep-rate summary.
  Run: `bt-run python betatetris-spike/keeprate.py [limit]`. Results + methodology:
  `../FINDINGS-betatetris-consensus.md`.
- `pull.py` — pull the sample from Supabase (13 quarantined + 20 current) → `sample.json`.
  Reads `DATABASE_URL` from `.sandcastle/.env`.
- `compare.py` — the original spike harness: inject each board, take BetaTetris's two-ply
  line, compare to our optimal/top-K, characterise towers/holes with the #50 audit metric.
  **Caveat:** it calls `InputPlacement` once per piece, which does **not** lock BetaTetris's
  two-phase (tap → `IsAdjMove` adjustment) placements — the cause of its misleading `0/33`
  (`keeprate.py` and the FINDINGS doc use the correct cadence).
- `smoke.py` — board-converter round-trip + one model forward (the feasibility proof).
- `dump_examples.py` — render board0 / our-optimal / BetaTetris boards for eyeballing.
- `results_*.json`, `sample.json` — captured outputs from the run.

## Reproduce (WSL, ~no GPU)
```bash
# 1. userspace toolchain+ML env (no sudo)
~/.local/bin/micromamba create -y -n bt -c conda-forge \
  python=3.12 'pytorch=*=cpu*' numpy scipy cmake make pybind11 gxx gcc onnxruntime
~/.local/bin/micromamba run -n bt pip install 'psycopg[binary]'
# 2. engine
git clone --depth 1 https://github.com/BetaTetris/betatetris-tablebase.git
( cd betatetris-tablebase/python/tetris && \
  micromamba run -n bt python setup.py build_ext --inplace )   # default args => rotation, kR=4
# 3. weights (from Releases)
curl -fL -o models/model-v1.0.0-perfect.pth \
  https://github.com/BetaTetris/betatetris-tablebase/releases/download/v1.0.0-perfect/model-v1.0.0-perfect.pth
# 4. run (paths in the scripts assume ~/bt-spike layout)
micromamba run -n bt python pull.py && micromamba run -n bt python compare.py
```
Key gotchas the scripts encode: board convention is **1=empty/0=filled** (inverse of ours);
pieces pass by **letter**; `Reset` needs `(10*lines+filled)%4==0` (use lines 0/1);
`str(Board)` omits empty top rows (place rows by their printed index).
