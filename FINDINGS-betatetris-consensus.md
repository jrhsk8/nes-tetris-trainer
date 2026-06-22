# FINDINGS — BetaTetris consensus keep-rate (#54 Phase 1)

**Date:** 2026-06-22 · **Status:** Phase 1 (MEASURE) complete · **Bank:** 280 puzzles (post #52/#53 regen).

## TL;DR

Measuring whether BetaTetris's **policy** blesses our stored optimal — the right
question for #54 — gives a **high, difficulty-uniform keep-rate**, not the empty
bank the spike's `0/33` implied:

- **Both nets agree (top-3 policy): 202/280 = 72%** — the recommended consensus keep-rate.
- Reachability is **280/280 (100%)** for each net: our optimal piece-1 outcome is *always* a legal, considered BetaTetris placement.
- Keep-rate is **flat across difficulty** (hard ≤2 accept: 72%, med 3–5: 71%, easy ≥6: 72%) — consensus does **not** preferentially delete the tightest puzzles.

This **overturns the spike's `0/33` NO-GO premise** (see *Why the spike said 0/33*).

## What was measured

For each puzzle we ask: *does BetaTetris's piece-1 policy seriously consider our
stored optimal's piece-1 placement?* — exactly the issue's "high in `π_BT` / in
its top-k" criterion. Method:

1. `generator/src/bt-bank-keys.ts` exports, in the **production convention**
   (`core.applyPlacement` + `boardKey`), each puzzle's outcome key after our
   optimal's **piece-1** placement (`p1_key`) and after both (`full_key`). The
   `full_key` was verified to match the stored `combos` rank-1 `boardKey`
   exactly — so both sides share one canonical 200-char outcome key and the
   comparison is **convention-free** (no rotation/col-number reconciliation).
2. `betatetris-spike/keeprate.py` injects board0, reads BetaTetris's piece-1
   policy, simulates every legal placement to its resulting board, and sums
   policy mass per **distinct outcome** (two rotation encodings that land the
   same cells share their mass). Our `p1_key` is then looked up: its policy mass
   `π_BT(optimal)` and its rank in that distribution. Run on both the `perfect`
   and `normal` v1.0.0 nets.

## Results (n=280; inject_ok 280/280; 0 odd-parity skips)

| metric | perfect | normal |
|---|---|---|
| optimal = BetaTetris **top-1** (exact consensus) | 155 (55%) | 170 (61%) |
| optimal in **top-3** | 231 (82%) | 232 (83%) |
| optimal in **top-5** | 255 (91%) | 248 (89%) |
| optimal **reachable / considered** | 280 (100%) | 280 (100%) |
| mean `π_BT(optimal)` | 0.547 | 0.609 |
| keep if `π_BT(optimal) ≥ 0.05` | 169 (60%) | 177 (63%) |

**Consensus across BOTH nets** (the conservative "both engines bless it" reading):

| criterion | keep-rate |
|---|---|
| both nets top-1 | 118/280 (42%) |
| **both nets top-3** | **202/280 (72%)** |
| both nets top-5 | 232/280 (83%) |
| both nets `π ≥ 0.05` | 133/280 (48%) |
| either net top-1 | 207/280 (74%) |

**By difficulty band** (both nets top-3): hard (≤2 accept) 87/120 = 72% · med
(3–5) 65/91 = 71% · easy (≥6) 50/69 = 72%. **Uniform** — no tactical/difficulty bias.

Raw per-puzzle rows: `$BT_OUT/keeprate_{perfect,normal}.json`.

## Why the spike said 0/33 (methodology correction)

The spike's `compare.py` called `InputPlacement` **once per piece**. BetaTetris
models a NES placement in **two phases**: a (here forced) pre-adjustment tap,
then an **adjustment** decision that actually locks the piece (`IsAdjMove` /
`step()` only advances `GetPieces` on the second call). So the spike's single
`InputPlacement` for an adj-move never locked — it left the board at board0 and
then read the *piece-1 adjustment* policy as if it were the *piece-2* decision.
Its `0/33` outcome-exact-match was therefore a **measurement artifact**, not a
real engine disagreement.

`keeprate.py` follows the correct cadence (take argmax; if `IsAdjMove`, apply the
pre-adjustment and re-read the policy at the adjustment phase, which is the real
distribution over final placements) and compares by **policy rank/mass**, not
single-best outcome equality. Both fixes matter: the cadence makes the
comparison valid, and the policy/top-k criterion is the right notion of "a move
BetaTetris seriously considers."

## Phase 2 — recommendation (owner decision)

A consensus gate is **viable** (72% both-nets top-3; not low-yield). But this
finding **reverses the documented premise** for #54 — the owner accepted a
"low-yield by design, more tactical, smaller bank" gate on the basis of `0/33`.
Reality: the keep-rate is high and **difficulty-uniform**, so a top-3-both gate
would drop ~28% of puzzles **without** the intended tactical re-shaping and
without preferentially culling hard puzzles. Because Phase 2 reshapes the live
bank on a now-falsified premise, the chosen criterion is an **owner call**:

- **top-3 / both nets (72%)** — light cull, keeps the difficulty spread.
- **top-1 / both nets (42%)** — strict "best move agrees" consensus; aggressive.
- **`π_BT ≥ τ` / both nets** — tune τ to a target bank size.

Tooling for the gate is in place (`bt-bank-keys.ts` + `keeprate.py` give the
per-puzzle verdict the generator would consume). Held pending the owner's choice
of criterion rather than reshaping the bank autonomously.
