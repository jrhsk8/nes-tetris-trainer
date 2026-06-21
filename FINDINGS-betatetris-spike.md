# FINDINGS — BetaTetris cross-check feasibility spike

> Verdict on `HANDOFF-betatetris-spike.md`. **Outcome: NO-GO on a BetaTetris-based
> gate — but the spike delivered its real prize: an independent strong engine
> *corroborates the #50 fix*.** Run supervised on CPU in WSL; no GPU, no production
> change. Adapter scripts: `betatetris-spike/` (throwaway; depend on the external
> GPLv3 repo, not committed to the build).

## TL;DR

- **Feasibility: confirmed.** BetaTetris's neural net is **not** CUDA-locked; the
  v1.0.0 "perfect" + "normal" nets run on **CPU** (~0.5 s/forward warm, ~1.8 s cold)
  in a no-sudo userspace env. The go/no-go *compute* gate the handoff flagged is GREEN.
- **BetaTetris never towers.** Across **231 two-ply picks/model** (33 puzzles × 7
  unknown next-pieces), **0 spike-towers** (both nets). On the 3 quarantined boards
  where our *pre-#50* optimal towered, BetaTetris explicitly refuses the tower.
  → **Independent corroboration that #50 was directionally right.**
- **But it is not a usable oracle for *our* optimal.** BetaTetris's preferred line
  matches our stored optimal **0 / 33** times, and lands in our **top-30 combos 0 / 33**
  times. The disagreement is *genuine and legitimate* (verified by eye — different but
  sensible clean boards), because BetaTetris optimizes **expected whole-game score with
  deep lookahead**, while our generator optimizes a **static 2-ply board eval**. It will
  even accept controlled digs (+2/+4 holes) where our objective wants the cleanest stack.
- **A BetaTetris gate adds nothing we can't get for free.** A "does-BetaTetris-agree"
  gate would flag ~100% of puzzles (useless); a "did-BetaTetris-tower" gate never fires
  on our post-#50 bank (and the cheap holes/Pareto audit already guarantees that).
  **→ NO-GO. Build the handoff's fallback instead** (deeper-StackRabbit cross-check +
  holes/Pareto CI gate — RALPH-friendly, zero new infra).

## What was built (CPU, no GPU, no sudo)

- **Env:** userspace `micromamba` (conda-forge) — `python 3.12` + `pytorch-cpu 2.12` +
  `gcc/gxx 15` + `cmake` + `pybind11`. Sidesteps the WSL sandbox's missing compiler /
  Python-3.14 / no-sudo. Fully reversible (`rm -rf ~/micromamba`).
- **Engine:** cloned `BetaTetris/betatetris-tablebase` (GPLv3), built the `tetris` C++
  extension (`setup.py build_ext`, default rotation build, `kR=4`), loaded the v1.0.0
  perfect + normal weights (~83 MB each, from Releases). The committed `noro.pth` is a
  *no-rotation* variant — wrong for NES; not used.
- **Board injection (the crux the handoff said to verify):** the `tetris.Board(...)`
  constructor accepts a `(20,10)` array; `Tetris.Reset(board=…)` injects it. Convention
  is **1=empty / 0=filled, row-major from top** (inverse of our `'1'=filled`).
  Round-trip + readback **validated 33/33** (`inject_ok`).
- **Pieces** pass through by **letter** (`ParsePieceID`: `'T'→0…'I'→6`), so identity is
  guaranteed despite different internal index orders.
- **Methodology, matched to the generator:** level 18; `lines` 0/1 by NES cell-parity
  (`(10·lines+filled)%4==0`); our `boardKey == encodeBoard`; BetaTetris piece-1 placement
  with `next=piece2`, then piece-2 **swept over all 7 possible next pieces** (BetaTetris
  always conditions on a next; our generator uses `nextPiece:null`). 30 Hz / adj-delay 18 /
  aggression low. Tower + holes use the **exact #50 audit metric** (`diag.py`).

## Results (33-puzzle sample: 13 pre-#50 quarantined + 20 current bank)

inject_ok **33/33**; odd-parity (non-NES) boards skipped: **0**; topped-out: **0**.

| metric | perfect | normal |
|---|---|---|
| BetaTetris spike-towers (of 231 picks) | **0 (0%)** | **0 (0%)** |
| BetaTetris matches our optimal (exact) | **0 / 33** | **0 / 33** |
| BetaTetris lands in our top-30 combos | **0 / 33** | **0 / 33** |
| BetaTetris holes mean / maxheight mean | 1.61 / 8.0 | 1.48 / 7.7 |

Holes, net vs board0:
- **quarantine:** our *old* optimal averaged **4.69 holes** (board0 1.85) — the #50 bug;
  BetaTetris: 73% no change, **20% digs holes out**, 8% +1.
- **current:** our optimal **1.40** (board0 1.35, clean — #50 working); BetaTetris: 76% no
  change, **19% adds +1..+4** (controlled digs for its whole-game objective).

Worked example (quarantined puzzle, `p1=Z p2=L`):
- board0 — clean, max height 9 (tetris well, col 9 open).
- **our old rank-1 — holes 0 but max 13: a col-0 spike-tower** (the #50 reason it was quarantined).
- **BetaTetris — max 9, no tower:** fills low and flat. *Refuses the tower our eval crowned.*

## Verdict & recommendation

**NO-GO** on building a sampled-BetaTetris "review-flag" gate. It cannot validate our
*specific* optimal (100% disagreement by design — different objective), and the one bug
class it confirms (no towers / no hole-burying) is already caught by the **holes/Pareto
audit** at zero infra cost. Maintaining an offline GPLv3 C++/Torch engine + ~8
forwards/puzzle for a signal we already have is not worth it.

**Do instead (the handoff's fallback — RALPH-friendly, file as issues "later"):**
1. Second, **deeper StackRabbit** config (`playoutCount > 0`) at generation; flag puzzles
   where the deeper search disagrees with the eval-only optimal.
2. Promote the **holes/Pareto outcome-quality audit** (#50) to a standing generator/CI gate.

**What the spike *did* deliver:** a second, strong, independent engine confirms the #50
direction — it never picks the towers/holey boards we now reject. That corroboration is
the durable result; keep it, drop the BetaTetris integration idea.

## Caveats (honesty)

- Tap-speed mismatch: our combos valued at ~10 Hz (`'X.....'`), BetaTetris at its native
  30 Hz. Affects the *reachable-placement set*, not the tower/hole conclusion.
- `level 18, lines 0/1` assumed (puzzles don't store level/lines); per the handoff.
- piece-2's true next is unknown → swept all 7; conclusions are stable across both nets.
- "perfect" net used per the run decision; "normal" agrees on every headline number.
