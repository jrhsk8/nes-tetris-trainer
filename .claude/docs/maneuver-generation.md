# Maneuver-puzzle generation — playbook

How to construct **engine-validated** puzzles whose optimal play is a specific NES
maneuver (tuck / spin / spintuck / VITS / dig). Hard-won; read before touching a
`*-bank-gen.ts`. Engine HTTP/setup details live in [engines.md](engines.md); piece
definitions in [glossary.md](glossary.md).

## The quality bar

Every maneuver puzzle must clear, in order:
1. **StackRabbit rank-1** — the maneuver is the engine's #1 optimal line (eval-only sweep; see gotchas).
2. **Interactive reachability** — `isInputReachable()` (`packages/core/src/placement.ts`): the optimal placement is reachable by the real play-app input under the descending-spin law. The generator's enumerated set must be a *superset* of what play can place, or grading wrongly rejects a legal tuck.
3. **BetaTetris consensus** — strict (p1 top-1 **and** p2 7/7 over all next-pieces) for line-clearing maneuvers; **relaxed** (optimal within BT top-K, default 3) for non-clearing ones (VITS) that strict 7/7 always rejects.

## The DIG insight (load-bearing)

**StackRabbit ranks a maneuver #1 only when it CLEARS a line AND REDUCES holes** (a
"dig"). A clean positional spin/tuck that clears nothing is **never** rank-1 —
measured 0/650+ clean S/Z line-clear spins ranked #1 (random + constructed +
self-play). BetaTetris likewise rejects non-clearing positional maneuvers as
objective quirks (self-play marginal spins agreed 0/115).

So to make a maneuver engine-agreed: **make it a dig** on a nearly-clean board (clears
a line + reduces holes), the way the accepted T-spin digs (#2443/#2444) work. Don't
conclude a maneuver type is "impossible" from clean-clear attempts — retry as a dig.
This is how S/Z spins shipped (`forced-sz-dig-bank-gen.ts` → #2502-2525). VITS is the
one exception that needs a non-clearing bar (below).

## BetaTetris piece-2 ≫ piece-1 asymmetry

BT enumerates a **piece-2** maneuver far better than a **piece-1** one (~54% vs much
lower). Design so the special maneuver is **piece 2** when you can. BT will *not*
7/7-agree a spintuck as piece 2 (p2=0/7), so strict spintucks end up **piece-1-only**
and scarce.

## Spintuck

**Definition (owner-final):** a placement reachable at NES **level-19, DAS-only ONLY
by a last-second rotation at depth** — the slot is under an overhang, so you can't
pre-rotate-and-drop in, and can't slide under the lip in the frames available. The
spin is the final seating input.

**Detector:** `isSpintuck` in `packages/core/src/nes-reachability.ts` =
idealized `maneuver()==='tuck'` **AND NOT** `slideReachableAtSpeed` **AND**
`spinReachableAtSpeed`. Tags `spintuck + spin + tuck + <piece>-spin`.

**Two wrong defs we rejected:** (1) "a spin that also needs a lateral tuck at depth" —
too strict, *missed the owner's J example* because that J is idealized-translation-
reachable so `maneuver()` calls it `tuck`, not `spin`. (2) "tuck + any rotation" — too
broad (swept in pre-rotated vertical-I tucks). The bridge: the J is an idealized tuck
that is **not slide-reachable at level-19 speed** yet **is spin-reachable** — that
asymmetry *is* the spintuck signature (speed-aware, no full frame sim).

**Generation:** random natural boards almost never contain spintuck geometry — it must
be **constructed**. `spintuck-board.ts` `constructSpintuckBoard()` builds a roofed
2-wide pocket connected to the wall (J-pattern), grounded by construction. ~17% host a
spintuck across S/Z/T/J/L; BT keep-rate ~17% (piece-1 limit) is the bottleneck.

## VITS (Vertical I Tuck Setup) — and the BURN PROBLEM

**What it is:** a setup piece fills a deep notch and a **vertical I** tucks an adjacent
pocket, making the board **tetris-ready when it wasn't before**. "StackRabbit sells out
for tetris-readiness," so the tuck can beat alternatives — *but only* in a narrow band.

**Owner's narrow-band rule:** a VITS is only optimal when the **tuck sits in the bottom
0-3 rows** (heights 0-3; height 0 works). Higher up, a plain tetris always beats it.

**THE BURN PROBLEM (the trap):** StackRabbit values an immediate line clear, so on any
board where a piece *can* clear a line it **burns** instead of doing the clean tuck.
The generated set **#2568-2580 turned out flawed** — all tagged `[burn,tetris-ready]`,
i.e. burns, not clean VITS. Owner caught it on **#2570** ("rates a VITS setup as 'too
low to rank' but it actually creates a cleaner board without burning"): the engine
ranks the *clean* tuck low and prefers the burn, so the puzzle trains the wrong move.

**A real (clean) VITS therefore needs a board where NO burn is possible:** a **covered
hole the I must dig** + a **separate preserved tetris well**, structured so filling the
hole does *not* complete any row (no line to burn, `|wellCol − tuckCol| ≥ 2`). Then
the clean dig-tuck → tetris-ready is genuinely the engine's optimum. (Corrective
direction; not yet shipped — #2568-2580 still need deactivating + rebuild.)

**Config:** VITS uses `valuationTimeline:'X.'` (the I must read as reachable),
`deeperConfirm:null` (shallow-unstable by design — its value is the I lookahead), and
the **relaxed** BT bar. Intentionally low-variety (the narrow band forces near-identical
boards) — mirror the board and vary the setup piece (J/L/T) to spread it.

## Board naturalness

Synthetic boards leak **floating islands** — a filled 4-connected component that never
reaches the floor, impossible to build by dropping pieces (a bank audit found 35/555).
Overhang *density* isn't the problem; the islands are. Gate every generator with
`isNaturalBoard()` (`board-natural.ts`: `hasFloatingIsland` + an overhang cap). Note:
over-taming a random board source kills the maneuver *sites* — clean geometry must be
**constructed**, not stumbled on.

## Engine gotchas that bite generation

- **Eval-only > playouts for ranking.** StackRabbit's playout path (`playoutCount>0`,
  `getTopMoves`) is unstable on awkward boards — it can value a hole-creating move
  *above* a clean one. Rank with eval-only (`rateMove`, `playoutCount:0`).
- **`valuationTimeline` changes reachability.** `'X.....'` (slow tap) makes tucks
  unreachable → a tuck stops being "optimal." Use `'X.'` (fast) when the answer is a tuck.
- **`deeperConfirm` rejects lookahead puzzles.** The deeper-confirm gate flags shallow-
  unstable optima as `deeper-quirk` / `eval-inversion`. Set `deeperConfirm:null` for
  puzzles whose value is the 2nd-piece lookahead (VITS).
- **`rateMove` throws on tucks** ("player move not found") — it only knows hard-drops
  under the timeline. Enumerate + apply + rate the *resulting board*, or use the combo
  table; don't ask it to rate a tuck placement directly.
- **The optimal-line outcome key has no row** — hard-dropping `{rotation,col}` mis-places
  a tuck/spin. Reconstruct the resting line from `combos.entries[0].boardKey` via
  `restingLineForEntry` (the tuck/spin consensus-key bug).

## Tooling

- **`gen-harness.ts`** — shared boilerplate every generator uses: `loadRepoEnv` (ws
  polyfill + `.env`), `createBetaTetrisJudge` (shells `consensus.py`),
  `createManagedStackRabbit` (engine + auto-restart, **shared-instance aware**),
  `loadActiveBankKeys` (paged dedup pull — Supabase silently caps `.select()` at 1000).
- **`generate-set.ts`** — orchestrator: `npx tsx generator/src/generate-set.ts
  --spintuck 6 --vits 8 --szdig 6` runs a mix in one pass on **one shared StackRabbit**,
  live output + inserted-per-type roll-up. `--dry-run` passes through.
- **Dedup:** in-batch Hamming (`boardHamming`, `BATCH_MIN_HAMMING≈8`) + bank-key dedup
  vs active puzzles; `bank-dedup-audit.ts` after batches.
- The 7 generators: `tuck-gen` `varied-maneuver-gen` `spin-bank-gen` `vits-bank-gen`
  `forced-spin-bank-gen` `forced-sz-dig-bank-gen` `spintuck-bank-gen`.
