# betatetris-spike (throwaway)

Adapter scripts for the BetaTetris cross-check feasibility spike. **Not part of the
build** — they depend on the external GPLv3 repo `BetaTetris/betatetris-tablebase` and
a CPU PyTorch env, both kept offline (per the engine-offline guardrail). Verdict and
analysis: `../FINDINGS-betatetris-spike.md`. Brief: `../HANDOFF-betatetris-spike.md`.

## Files
- `pull.py` — pull the sample from Supabase (13 quarantined + 20 current) → `sample.json`.
  Reads `DATABASE_URL` from `.sandcastle/.env`.
- `compare.py` — the harness: inject each board, take BetaTetris's two-ply line (piece-2
  swept over 7 next pieces), compare to our optimal/top-K, characterise towers/holes with
  the #50 audit metric. Runs perfect + normal nets → `results_{perfect,normal}.json`.
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
