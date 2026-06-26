# Glossary — Ubiquitous Language

Shared vocabulary for the NES Tetris Stacking Trainer. Terms here are used verbatim in code, docs, and conversation. Full context: [PRD-v1.md](PRD-v1.md).

### Stacking

The judgment of *where* to place each piece — the skill the trainer measures — including higher-level line-clear strategy (burn-vs-build, tetris setup), not just where a single piece sits. Deliberately separated from execution (tapping/DAS speed).

### Piece / next-piece puzzle

The puzzle unit: a board plus the current piece and the next piece. The player places the current piece (knowing the next), then places the next piece — **placing both regardless of whether the first was optimal** (since the 2026-06-20 combo overhaul). The answer is graded as a [two-piece combo](#two-piece-combo).

### Two-piece combo

A specific pair of placements `(placement₁, placement₂)` — the player's full answer to a puzzle. Its value is StackRabbit's evaluation of the board after **both** pieces are placed. A puzzle's universe of answers is the cross-product of every **collision-reachable resting placement** (hard-drop, [tuck, or spin](#tuck--spin)) for the first piece × every reachable resting placement for the second on the board that first placement produces. (Pre-2026-06-21 the universe was hard-drops only.)

### Optimal line

The best (rank-1) [two-piece combo](#two-piece-combo) for a puzzle — the highest-scoring pair. Still the headline answer, but grading is now by [combo score](#combo-score) threshold rather than exact match.

### Combo score

A [two-piece combo](#two-piece-combo)'s **gap from the best combo**, in raw StackRabbit eval units, mapped to **0–100** as `score = clamp(100 − k·(bestValue − value))` with `k = 0.625` (since 2026-06-21, #47). The best (rank-1) combo scores 100; the same absolute gap yields the same score on every puzzle (cross-puzzle comparable). This **replaces** the earlier min-max normalization (best = 100, *worst legal* = 0), whose worst-legal anchor — a deeply negative digging/topping-out outlier — compressed every reasonable move into the high 90s, so a genuinely mediocre answer scored ~96 and graded correct. **Correct (= [A+](#letter-grade)) = score ≥ 97** — raised from 95 in grill-with-docs #5 (2026-06-22); the score formula and `MARGIN` are unchanged, only the success cutoff moved, so correct is now being within a **~4.8-unit eval gap** of the best. The score is stored to one decimal (a float, since #5) and shown as a [letter grade](#letter-grade) plus the one-decimal number beside each combo in feedback. Combos too bad to rank (beyond the stored top-K) are off-scale.

### Combo-threshold grading

v2 grading (replaces the v1 [exact-match checker](#exact-match-checker)). The player always places both pieces; the attempt is scored by its [combo score](#combo-score). An attempt is **Correct** iff its combo scores **≥ 97** (an [A+](#letter-grade); raised from 95 in grill-with-docs #5), else **Incorrect**. There is no first-move short-circuit — a weak first move simply caps the combo's score. An attempt matches a stored combo by its **resulting board** (the locked cells after both pieces) — outcome, not `(rotation, col)` or input path — so a [tuck, spin](#tuck--spin), or any rotation-encoding that lands the same cells counts as the same answer. (This is the actual fix for the "identical to #1 but graded wrong" report: the v1 short-circuit failed the puzzle on a first move that merely differed from the engine's setup move.) Drives the [verdict](#verdict) and the binary solved/failed signal for [co-rating](#co-rating).

### Exact-match checker

v1 grading, **superseded** by [combo-threshold grading](#combo-threshold-grading). The player had to match the optimal first *and* second placement (match = same final resting column + rotation); a wrong first placement failed the puzzle immediately and revealed the optimal line, with no separate grading of move 2.

### Verdict

The result feedback shown after an attempt, so the outcome is unmistakable. Since grill-with-docs #5 (2026-06-22) the headline is a **grade banner overlaid on the top of the board well** — the big [letter grade](#letter-grade) plus the one-decimal score, **green for A+ (win) / red for below** — persisting until the next puzzle, accompanied by a distinct NES chiptune (arpeggio for A+, soft blip for below). The right rail is slimmed to the rating-change line. (Earlier this was a Correct/Incorrect banner in the right rail; it answered the old complaint that nothing made clear what happened after you entered your answer.)

### Letter grade

The player-facing rendering of a [combo score](#combo-score) (since grill-with-docs #5). The 0–100 score maps to a standard US 12-band letter on **half-open intervals**: A+ = [97,100], A = [93,97), A- = [90,93), B+ = [87,90), B = [83,87), B- = [80,83), C+ = [77,80), C = [73,77), C- = [70,73), D = [60,70), F = [0,60) and unranked. **A+ is the success line** — it coincides with [Correct](#combo-threshold-grading) (score ≥ 97) and is the only grade that gains [co-rating](#co-rating). Shown as the letter plus the raw score to one decimal (e.g. `A+ 97.6`) on the [verdict](#verdict) banner and every combo-list row.

### Clean board

A board the generator prefers because it resembles a position a strong player would actually reach: few or no [holes](#combo-score), low bumpiness, and moderate height. Since grill-with-docs #5 the generator's default accept is **strict-clean** (target holes ≤ 1, bumpiness ≤ ~12, max height ≤ ~12), with a smaller **[variety lane](#strict--variety-lane)** (~20% of the bank: holes ≤ 2, bumpiness ≤ ~20) so some texture survives. Cleaner boards are the better teaching material, so a lower candidate yield is an accepted cost. Distinct from the older fairness/health and [rank-1 outcome-quality gates](#rank-1-quality-gate), which reject *unplayable* or *degenerate* boards rather than merely *messy* ones.

### Combo table

The per-puzzle store of the **top-K (K ≈ 30) ranked two-piece combos** — each combo's placements, its [combo score](#combo-score), and a canonical **resulting-board key** (the locked cells, used for [outcome matching](#combo-threshold-grading)), plus the total count of ranked combos. Generation evaluates the full cross-product — now spanning [tuck/spin](#tuck--spin) placements — to rank and normalize, but persists only the top-K, so rows stay small and the play app needs no live engine. Replaces the v1 [value tables](#value-table).

### Value table

v1 data, **superseded** by the [combo table](#combo-table). Two independent per-piece lists (`first_values` over all legal piece-1 placements; `second_values` over all legal piece-2 placements on the board after the optimal first move). No cross-product existed, because v1 ended the puzzle on a wrong first move.

### Ranked combo list

The post-attempt feedback display (replaces the v1 [solutions chart](#solutions-chart)): a stacked, ranked list of the **top-5** combos with their 0–100 [scores](#combo-score). The player's combo is highlighted if it is among the top-5; otherwise it appears in a row below — with its exact rank + score if it ranks 6–K, or marked **"too low to rank"** if it falls beyond the stored top-K. Rows are **interactive**: selecting one animates that combo on the central board (the [replay](#replay) parameterized by `(p1, p2)`); the player's own move is selected by default.

### Solutions chart

v1 feedback display, **superseded** by the [ranked combo list](#ranked-combo-list). Two per-piece value distributions drawn as strip plots (a dot per legal placement, ★ = optimal, ● = the player's move, with a rank callout).

### Board-health floor

A generation gate (R3) for cleaner *starting* boards: keep a candidate snapshot only if the **minimum best-move value across all 7 piece types** clears a moderate, tunable floor — a piece-independent proxy for "a board StackRabbit rates highly," since StackRabbit exposes no static board evaluation. A cheap [geometric](#geometric-metrics) pre-filter (holes/bumpiness) drops obvious garbage before the engine calls. Runs before the combo sweep. (2026-06-21: **relaxed** to a fairness/garbage-only floor — the original high floor kept clean boards where many moves are fine, biasing the bank toward easy; [difficulty](#difficulty) shaping now does the rest.)

### Difficulty

A per-puzzle generation property (since 2026-06-21), computed from two combo-distribution signals and stored raw: **`acceptCount`** — the number of distinct combos scoring ≥ 97 (the [combo-threshold](#combo-threshold-grading) accept bar, `CORRECT_SCORE_THRESHOLD`; few acceptable answers = hard) — and **`margin`** — `100` minus the best score *strictly below* the accept bar (a large margin means the answer stands alone, hard to hit by luck). Combined into the puzzle's **seed rating** (harder → higher seed), which bootstraps [matchmaking](#matchmaking) immediately rather than waiting for crowd data. The bank is biased toward hard with an easy tail kept for new/low-rated players; per the player's own definition, an *easy* puzzle is one with "many acceptable highly-rated moves." **Bands (since grill-with-docs #6, 2026-06-22): `very-easy` / `easy` / `medium` / `hard`**, bucketed by `acceptCount` on tunable cutoffs — `hard` ≤ 2 (`HARD_MAX_ACCEPTS`), `medium` = 3–7 (the residual), `easy` ≥ 8 (`EASY_MIN_ACCEPTS`), `very-easy` ≥ 16 (`VERY_EASY_MIN_ACCEPTS`). `very-easy` is the most forgiving (highest `acceptCount`), seeded below the old `EASY_SEED`. A puzzle where **any acceptable combo (score ≥ 97) clears a tetris** (a single 4-row clear by one of its two placements) is **capped at `easy`** — never `medium`/`hard`, with `acceptCount` choosing `easy` vs `very-easy` under the cap and the seed rating capped to match — because cashing a recognizable tetris is trivial regardless of how tight the answer set is. The tetris cap is detectable offline from the stored [combo table](#combo-table) (replay the placements, count cleared rows), so it is a cheap re-band, not a fresh sweep.

### Deduplication

A generation gate (since 2026-06-21): reject a candidate whose **`(piece1, piece2)` match and whose board is within a small Hamming distance** of any puzzle already accepted — checked against both the in-progress batch and the existing [bank](#the-bank). Catches *near-identical* look-alikes (different IDs, same-looking board), not just byte-identical duplicates. Complements the play-side [anti-repeat cooldown](#anti-repeat-cooldown): dedup keeps look-alikes out of the bank; the cooldown keeps the same puzzle from recurring too soon.

### Unambiguity gate (fairness gate)

v1 generation filter, **dropped** for combo grading on 2026-06-20. It kept a candidate only if the best line beat the second-best by a large margin on both placements, to make exact-match grading fair. [Combo-threshold grading](#combo-threshold-grading) needs no unique best, so the gate was removed; board quality is now ensured by the [board-health floor](#board-health-floor) and meaningfulness by the [combo-threshold](#combo-threshold-grading) accept bar (≥97, was ≥95 pre-#5) (accepted risk: an occasional trivially-passable puzzle).

### Hz-invariance

A generation filter: keep a candidate only if its **best combo** is identical across the full range of **left/right movement speeds** (slowest tap to fastest DAS). "Execution speed" here means **horizontal traverse speed only** — how far a piece can be moved left/right before it locks. [Tuck and spin](#tuck--spin) *capability* is **granted** (assumed always executable) and is explicitly **not** gated, so a tuck/spin can be the optimal answer. The puzzle is agnostic to horizontal movement speed — never to stacking judgment or tuck/spin skill. (2026-06-21: narrowed from "all piece-movement speeds" to left/right only, reinstating tucks as legal answers. 2026-06-20: retargeted from "optimal move per ply" to "best combo.")

### Slow-tap / fast-DAS

The two extremes of **left/right** piece-movement speed: slowest manual tapping vs. fastest DAS (Delayed Auto Shift — the auto-repeat when a direction is held). The endpoints checked for [Hz-invariance](#hz-invariance). They bound horizontal traverse only; tuck/spin reachability is assumed (see [tuck / spin](#tuck--spin)).

### Tuck / spin

A resting placement reached by sliding a piece **under an overhang** (tuck) or **rotating it into a pocket** (spin) — one a straight hard-drop can't reach, so it rests *lower* than the drop column would allow. The distinction is **[translation-reachable](#translation-reachable)**: a tuck is reachable by translation (soft-drop + left/right) alone; a spin requires a rotation at depth to fit into a pocket translation can't reach. As of 2026-06-21 these are **first-class**: the generator enumerates them as combo candidates, StackRabbit values them, a tuck/spin can be the [optimal line](#optimal-line), and the [ghost](#ghost-placement) can place them. They are pure stacking judgment, not [execution](#hz-invariance) — the trainer grants the maneuver and grades only where the piece rests. *Binding invariant:* the generator's enumerated placement set must be a **superset** of what the play-app input can place, or [outcome matching](#combo-threshold-grading) would wrongly reject a legal tuck.

### Translation-reachable

A placement that can be reached from the top of the board using only **soft-drop and lateral movement** (no rotation at depth). The [maneuver](#maneuver) classifier uses this to distinguish tucks (translation-reachable but not a hard-drop) from spins (not translation-reachable — requires rotation at depth). A BFS from `(row 0, col, rotation)` with moves {down, left, right} determines reachability; the BFS is in `packages/core/src/tags.ts` (`translationReachable`).

### Maneuver

The BFS-based classifier (`packages/core/src/tags.ts:maneuver()`) that labels a resting placement as **`hard-drop`**, **`tuck`**, or **`spin`**. Decision tree: if the piece can reach its resting row by a straight vertical drop → `hard-drop`; else if [translation-reachable](#translation-reachable) → `tuck`; else → `spin`. Used at generation time to [tag](#puzzle-type-tag) puzzles and to classify combos. NES Tetris has **no wall kicks and no lock delay**, so a "spin" means the piece must rotate at a height where the rotated shape already fits, then settle — there is no SRS-style kick.

### T-spin

A [spin](#tuck--spin) whose piece is **T**. In NES Tetris (no SRS/wall kicks), a T-spin is simply rotating the T piece at depth into a pocket it couldn't reach by translation. T-spins are the **most common spin subtype** because the T's symmetric cross shape fits more pocket geometries than other pieces. Tagged `t-spin` alongside `spin` on puzzles where the optimal combo includes one ([type-tags](#puzzle-type-tag)). Each of the five spinnable pieces has its own per-piece tag — `t-spin` / `s-spin` / `z-spin` / `l-spin` / `j-spin` (`SPIN_TAG` in `packages/core/src/tags.ts`); O can't rotate and I is not a meaningful spin piece.

### Spintuck

A placement reachable at NES **level-19, DAS-only ONLY by a last-second rotation at
depth** (owner's final definition) — the slot is under an overhang, so you can't
pre-rotate-and-drop in, and can't slide under the lip in the frames available; the spin
is the final seating input. Detector: `isSpintuck` (`packages/core/src/nes-reachability.ts`)
= idealized [`maneuver()`](#maneuver)`==='tuck'` **and not** `slideReachableAtSpeed` **and**
`spinReachableAtSpeed` (speed-aware, no frame sim). Tagged `spintuck + spin + tuck +
<piece>-spin`. Distinct from a plain [tuck/spin](#tuck--spin): a spintuck looks like an
idealized tuck (translation-reachable given unlimited time) but at level-19 speed only the
rotation gets it in. Generation is constructive (`spintuck-board.ts`) — random natural
boards almost never contain the geometry. See [maneuver-generation.md](maneuver-generation.md).

### Special-maneuver generation

The offline pipeline that *deliberately constructs* puzzles whose optimal play is a specific [tuck/spin](#tuck--spin), rather than waiting for self-play to stumble on one (it almost never does — and the marginal spins it finds disagree with [BetaTetris](#betatetris)). Established by the live t-spins (`generator/src/spin-bank-gen.ts`): build a board where a **line-clearing** maneuver is *forced* to be the only way to complete rows, run the full [combo](#combo-table) pipeline, then keep only those that are StackRabbit **rank-1** and pass the [BetaTetris](#betatetris) [consensus gate](#consensus-gate) (strict [7/7](#77-consensus--relaxed-bar)). **The line-clear is the crux** — a line-cashing spin is unambiguously the best play (both engines agree, and it never reads as artificial), whereas a non-clearing positional spin is an objective quirk BetaTetris rejects. Since grill-with-docs #9 this is generalized to **per-piece** forced line-clearing constructors (J/L/S/Z-spin, spintuck, more tucks), each additionally gated on **interactive-reachability** (the optimal maneuver must be reachable by the real input under the descending-[spin](#ghost-placement) law). [VITS](#vits-vertical-i-tuck-setup) is the exception that needs the [relaxed bar](#77-consensus--relaxed-bar).

### VITS (vertical I tuck setup)

A puzzle type (owner's coinage) whose optimal play is a **vertical I tucked into a covered
pocket, making the board [tetris-ready](#puzzle-type-tag) when it wasn't before** — "StackRabbit
sells out for tetris-readiness," so the tuck can be the best play. Acceptance: rank-1 +
[interactively reachable](#tuck--spin) + the [relaxed BetaTetris bar](#77-consensus--relaxed-bar) (top-K, K=3 — strict 7/7
rejects a non-clearing I-tuck); config uses `valuationTimeline:'X.'` (the I must read as
reachable) and `deeperConfirm:null` (its value is the I lookahead — the deeper-confirm gate
wrongly rejects it). Teaches recognizing the tuck instead of wasting the piece.

**Two hard constraints learned the hard way:**
- **Narrow band:** a VITS is only optimal when the **tuck sits in the bottom 0-3 rows** (height
  0 works); higher up a plain tetris always beats it.
- **The burn problem:** StackRabbit values an immediate line clear, so on any board where a piece
  *can* clear a line, it **burns** instead of doing the clean tuck. A real (clean, non-clearing)
  VITS therefore needs a board where **no burn is possible** — a covered hole the I digs **plus a
  separate preserved tetris well**, so filling the hole completes no row. The generated set
  **#2568-2580 turned out to be burns, not clean VITS** (owner caught it on #2570: the clean tuck
  read "too low to rank") — they need deactivating + rebuild. See
  [maneuver-generation.md](maneuver-generation.md).

### Puzzle type-tag

A per-puzzle descriptor (since #81/#84/#90) auto-computed from the optimal combo at generation time: what the puzzle *teaches*. Tags span four families: **clear** (`burn`, `tetris`, `tetris-ready`, `dig`), **maneuver** (`tuck`, `spin`, `spintuck`, and the per-piece spins `t-spin`/`s-spin`/`z-spin`/`l-spin`/`j-spin`), **stack** (`clean-stacking`, `well-maintenance`), and **avoid** (`avoid-i-dependency`, `avoid-s-dependency`, `avoid-z-dependency`, `avoid-j-dependency`, `avoid-l-dependency`). A puzzle carries zero or more tags; the play app renders them as coloured chips. Tags also power **drill mode** — filtering the bank to practice a specific tag family. The full tag vocabulary and display config lives in `apps/play/src/tags/tagVocab.ts`.

### Avoid-dependency

An [avoid](#puzzle-type-tag) tag applied when the optimal combo's resulting board does **not** create a single-piece dependency that the non-optimal combos do — i.e. the optimal play *avoids* needing a specific piece next. Dependencies checked: **I** (a 1-wide well ≥ 3 deep), **S**, **Z**, **J**, **L** (notches only one of those four pieces can hard-drop to fill cleanly). O and T are excluded from dependency detection (too symmetric / too versatile). The tag reads as "this puzzle rewards recognizing and avoiding a piece dependency." Logic in `packages/core/src/tags.ts` (`findDependencies`, `avoidDependencyTags`).

### Geometric metrics

Board measures: **holes** (empty cells with a filled cell somewhere above), **bumpiness** (sum of height differences between adjacent columns), and **height** (the stack's overall height). Used in the generator's [board-health](#board-health-floor) pre-filter and to precompute optimal-side metrics; the player-side values are computed client-side. Not shown to the player (feedback is the [ranked combo list](#ranked-combo-list)).

### Self-play / board source

Generation sources candidate boards via simulated semi-random self-play (mostly-optimal policy with occasional injected suboptimal moves), snapshotted at a random mid-game point. The board source is a pluggable interface; self-play is the only v1 implementation, with real-gameplay extraction anticipated behind the same interface. (The injected-noise rate may be lowered to feed the [board-health floor](#board-health-floor) cleaner candidates.)

### StackRabbit

The **primary, authoritative** NES Tetris AI engine ([github.com/GregoryCannon/StackRabbit](https://github.com/GregoryCannon/StackRabbit), **MIT**). A C++ core behind a local Express HTTP server. The first of the project's **two offline engines** (the other is [BetaTetris](#betatetris)) and the one that **owns ranking and scoring** — it produces the [combo table](#combo-table), the [optimal line](#optimal-line), and every [combo score](#combo-score). Used only in the offline generator; never deployed, never queried at play time. Scores *moves* (placements with lookahead); it has **no static whole-board rating** — hence the piece-averaged [board-health floor](#board-health-floor) proxy. Operating detail: [engines.md](engines.md).

### Eval-only vs playouts

StackRabbit's two ranking modes, and the project's standing convention to **rank with eval-only**. *Eval-only* (`rateMove`, `playoutCount: 0`, the client default) scores a placement directly; *playouts* (`getTopMoves` / `engine-movelist-cpp`, `playoutCount > 0`) run a lookahead search. Playouts are **unstable on awkward boards** — observed valuing a hole-creating move *above* a clean one — so the [combo table](#combo-table) is built eval-only. Playouts are reserved for the [deeper-confirm gate](engines.md) (a re-valuation of the top eval-only contenders). Confusing the two silently produces wrong puzzles, so it is a load-bearing convention, not a perf tweak.

### BetaTetris

The project's **second** offline engine ([github.com/GregoryCannon/betatetris-tablebase](https://github.com/GregoryCannon/betatetris-tablebase), **GPLv3**) — a Python neural net, spawned on demand (no server). It is a **veto-only gate**, *not* a co-authority: [StackRabbit](#stackrabbit) remains the sole authority on ranking, scoring, and the [combo table](#combo-table); BetaTetris can only **drop** a candidate puzzle on disagreement, never re-rank or relabel its answer (see [consensus gate](#consensus-gate)). Used only in the offline generator; never deployed. Only its **normal net** is used — the `perfect` net is off-objective (tetris-only) for a general stacking trainer. The GPLv3/MIT split is why the two engines must stay distinct concepts (this build never *distributes* either binary, so the GPL obligation isn't triggered). Operating detail: [engines.md](engines.md).

### Consensus gate

The final generation [acceptance gate](#special-maneuver-generation): keep a candidate only if [BetaTetris](#betatetris) agrees with [StackRabbit](#stackrabbit)'s optimal. A **two-stage strict check** (`generator/src/pipeline/consensus.ts`, `consensus.py`): (1) **piece-1** — is our optimal's piece-1 outcome BetaTetris's rank-1 policy move? (2) **piece-2** — given BetaTetris's own top-1 piece-1, does its top-1 piece-2 match our outcome across **all 7 next-pieces** ([7/7](#77-consensus--relaxed-bar))? Keep iff both pass. **Fail-closed:** anything *unjudgeable* is dropped, never kept — so engine flakiness can only ever shrink the bank, not pollute it. A **filter, not a re-rank** — disagreers are dropped, never relabelled with BetaTetris's move. Each drop carries a distinct **verdict reason**: `disagree` (piece-1 reachable but not rank-1 — the real cull), `disagree-p2` (piece-1 ok but piece-2 below the bar), `unreachable` (our optimal isn't in BetaTetris's move set at all), `odd-parity` (a board parity BetaTetris's reset can't accept), `inject-mismatch` (the injected board round-trips wrong), and `bt-error` (an exception while judging, counted separately).

### 7/7 consensus / relaxed bar

The two **piece-2 agreement bars** the [consensus gate](#consensus-gate) can apply. **7/7 (strict)** is the default: BetaTetris's top-1 piece-2 must match our outcome for **all seven** possible next-pieces (`P2_THRESHOLD = 7`) — the "7" counts the seven piece types, not a score. **Relaxed bar (top-K, K=3)** is the exception for **non-clearing positional maneuvers** ([VITS](#vits-vertical-i-tuck-setup) especially), which strict 7/7 wrongly rejects: our optimal need only fall within BetaTetris's **top-K** policy moves, K=3, calibrated from BetaTetris's policy-rank distribution. A clearing maneuver clears strict 7/7; a clean positional tuck needs the relaxed bar.

### Piece-1/2 yield asymmetry

The empirical rule that **BetaTetris enumerates piece-2 maneuvers far better than piece-1** (~54% vs much lower), because its policy barely enumerates piece-1 non-hard-drops. Consequence: BetaTetris will *not* [7/7](#77-consensus--relaxed-bar)-agree a [spintuck](#spintuck) served as **piece 2** (p2 = 0/7), but *will* agree the same maneuver as **piece 1** — so [special-maneuver generation](#special-maneuver-generation) designs the maneuver as the piece whose yield clears the bar (piece-2 for most tucks/spins; piece-1 for strict spintucks, which is why strict spintucks are scarce). The asymmetry, not the maneuver's difficulty, is why some maneuver types are hard to bank.

### Burn

A **non-tetris line clear** — cashing 1–3 rows instead of holding out for a [tetris](#puzzle-type-tag) (the standard NES "burn vs build" sense). A puzzle is tagged `burn` when its optimal combo's best play completes fewer than four rows. **The burn problem** (a generation trap): [StackRabbit](#stackrabbit) values an immediate clear, so on any board where a piece *can* clear a line it **burns** rather than play a clean non-clearing tuck — which is why a real [VITS](#vits-vertical-i-tuck-setup) needs a board where *no* burn is possible (#2568-2580 were flawed burns mis-banked as clean tucks). See [maneuver-generation.md](maneuver-generation.md).

### Dig

Filling a **covered hole** *while* clearing a line — a clear that also **reduces holes**. Tagged `dig`. Also the **DIG insight** (the load-bearing generation rule): both engines rank a tuck/spin #1 **only when it both clears a line and reduces holes** — a clean, non-clearing positional maneuver is essentially never rank-1 (measured 0/650+). So [special-maneuver generation](#special-maneuver-generation) deliberately makes the maneuver a *dig* to win engine agreement; `dig` outranks `tetris` in the [`dominantTag`](#anti-streak) precedence. See [maneuver-generation.md](maneuver-generation.md).

### Tetris-ready

A board with a **clean 4-deep well** (one empty column ≥ 4 rows deep, the rest level enough) primed to cash a [tetris](#puzzle-type-tag) with a single vertical I. Tagged `tetris-ready`. It is the payoff a [VITS](#vits-vertical-i-tuck-setup) creates — "StackRabbit sells out for tetris-readiness," so a tuck that *makes the board tetris-ready when it wasn't* can beat the alternatives (only in the narrow bottom-0-3-rows band). Distinct from `tetris` (a clear that actually happens): tetris-ready is the *setup*, not the cash.

### Synthetic

**Prohibited.** Any combo [score](#combo-score), value, or rating input **not produced by a real engine evaluation** — e.g. derived from board [metrics](#geometric-metrics) as a stand-in for a [StackRabbit](#stackrabbit) eval. **Standing invariant: every banked score traces to a real StackRabbit eval; no puzzle result is ever synthetic.** Caught once as ~70 puzzles carrying metric-derived scores (soft-deleted and rebuilt). Strictly about *scores/values* — the orthogonal concern of a physically-impossible *board* is owned by [natural board](#natural-board), not this term.

### Deeper-confirm gate

A generation gate (#53/#59, `generator/src/pipeline/deeper.ts`): after the [eval-only](#eval-only-vs-playouts) sweep, the top contenders are re-valued with a **playout search** to catch eval-only quirks. Outcomes: `confirmed`, `reranked` (promote the deeper-best), or **reject** (surfaced as `deeper-quirk` / `eval-inversion`). It **wrongly rejects** puzzles whose optimum is *shallow-unstable by design* — value coming from the 2nd-piece lookahead, e.g. [VITS](#vits-vertical-i-tuck-setup) — so those generators pass `deeperConfirm: null` to skip it. See [engines.md](engines.md).

### valuationTimeline (inputFrameTimeline)

The [StackRabbit](#stackrabbit) knob that sets **how fast left/right input is** during evaluation, which decides **which placements are reachable** — the engine-side encoding of [slow-tap / fast-DAS](#slow-tap--fast-das). `'X.....'` (slow tap) makes tucks/spins *unreachable*, so a tuck stops being "optimal"; `'X.'` (fast DAS) restores it. A generator whose intended answer is a tuck/spin **must** set `'X.'`, or the maneuver silently fails to rank. (`X` = a shift frame, `.` = a wait frame.)

### Natural board

A board that could **actually be reached by dropping pieces**. Constructed/synthetic boards leak **floating islands** — a filled 4-connected component that never touches the floor (impossible to build by stacking; a bank audit found 35/555). Every generator gates on **`isNaturalBoard()`** (`board-natural.ts` = `hasFloatingIsland` + an overhang-density cap). Distinct from a [clean board](#clean-board) (about *messiness*, not physical *legality*) and from [synthetic](#synthetic) scores (about *values*). Over-taming the board source kills maneuver *sites*, so clean maneuver geometry is **constructed**, then naturalness-gated.

### Rank-1 quality gate

A generation gate on the **winning** combo's resulting board (not merely its rank): reject a rank-1 whose outcome is degenerate — `rank-1-holey` (creates too many holes) or `rank-1-tower` (builds an unreasonable tower); knobs `holeMargin` / `towerMinHeight` / `towerHeightMargin` (`generator/src/pipeline/combo.ts`). This is the "outcome-quality" check the [board-health floor](#board-health-floor) alludes to — it rejects a *bad-optimum* puzzle that the *starting*-board floor would pass.

### Value-sanity invariant

A ranking invariant on the [combo table](#combo-table): **a board with strictly more holes can never outrank a cleaner one** (`holesDominate` / `rankCombosBySanity`, `combo.ts`). Guards against an [eval](#eval-only-vs-playouts) quirk letting a hole-creating combo claim rank-1, which would corrupt the [optimal line](#optimal-line), [difficulty](#difficulty), and grading.

### Strict / variety lane

The two acceptance lanes of the [clean-board](#clean-board) gate (`BoardLane`, `classifyLane`, `generator/src/pipeline/generate.ts`). **`strict`** is the default clean target; **`variety`** (~20% of the bank, `varietyLane.fraction = 0.2`) admits messier boards so some texture survives; results bucket by `byLane`. The named mechanism behind the [clean board](#clean-board) entry's "strict-clean default + smaller variety lane."

### Interactive reachability

A mandatory maneuver-quality gate: the optimal placement must be **reachable by the real play-app input** (`isInputReachable()`, `packages/core/src/placement.ts`) under the descending-[spin](#ghost-placement) law. Closes the generator↔play loop — the generator's enumerated [resting](#tuck--spin) set must be a *superset* of what play can place, or [outcome matching](#combo-threshold-grading) would wrongly reject a legal tuck. Distinct from [translation-reachable](#translation-reachable) (a pure geometry classifier); this gate is about the *actual input model*.

### gen-harness / generate-set

The shared generation **plumbing** (`generator/src/gen-harness.ts`) every maneuver generator imports instead of re-implementing: `loadRepoEnv` (ws polyfill + `.env`), `createBetaTetrisJudge` (shells [consensus.py](#consensus-gate)), `createManagedStackRabbit` (auto-restarting, shared-instance-aware engine), `loadActiveBankKeys` (paged dedup pull — Supabase caps `.select()` at 1000). **`generate-set.ts`** is the orchestrator: `npx tsx generator/src/generate-set.ts --spintuck 6 --vits 8 --szdig 6` runs a mix on **one shared StackRabbit** with an inserted-per-type roll-up. See [engines.md](engines.md).

### Replay

The post-attempt animation on the central board (**not** to be confused with [Review misses](#review-misses), which is *re-attempting* a puzzle you got wrong): a piece spawns at top-center, performs one eased rotate-and-slide during the upper part of the fall, then drops straight to rest (clip-checked, with a flash-and-collapse on a line clear; honors `prefers-reduced-motion`). Now **color-aware** (base = the puzzle's [color grid](#color-grid); each dropped piece paints its NES color group) and **parameterized by combo** — it can animate any combo selected in the [ranked combo list](#ranked-combo-list), not just the optimal line. (2026-06-21: must now animate [tucks/spins](#tuck--spin) — slide under overhangs / rotate into pockets — since a combo's optimal need no longer be a straight drop; the "drop straight to rest" path is no longer a safe assumption.)

### Co-rating

Both players and puzzles carry a Glicko-2 rating (rating + deviation + volatility). Solving a higher-rated puzzle raises yours; failing lowers it. "Solved" = the attempt's [combo score](#combo-score) ≥ 97 (an [A+](#letter-grade)). Puzzle ratings are **seeded from generated [difficulty](#difficulty)** (not flat) and drift toward true difficulty as attempts accumulate. Since 2026-06-26 (#99) **both** sides persist **live, client-side per attempt** under an [anonymous session](#anonymous-session) (RLS no longer drops the write) — so puzzles filter up/down in real time, not only when the offline tally runs (which is now superseded; see [decisions](decisions.md)). Both sides also get a **[placement boost](#placement-boost)** so a fresh player/puzzle converges fast then settles.

### Placement boost

A "strong-early-then-settle" amplifier on every [co-rating](#co-rating) update (since 2026-06-26, #99): the rating move is multiplied by a factor that decays from **3× at the seed rating deviation (RD 350) to 1× once RD reaches 110** (the settled / Lichess-"provisional" line), capped per attempt so no fluke teleports a rating. Because it rides on RD (which only shrinks as games accumulate), the boost fades on its own "after a number of rating changes" — a fresh true-1900 player reaches ~1840 in ~8 attempts instead of ~40, then moves in single digits. The USCF dynamic-K idea on top of Glicko-2; only the rating delta is amplified (RD/volatility keep their Glicko values). Deliberately chosen over loosening the [graded reward curve](#graded-reward-curve) so steady-state rating movement stays stable.

### Win line

The everyday name for the **97** cutoff (`CORRECT_SCORE_THRESHOLD`): a [combo score](#combo-score) ≥ 97 is an [A+](#letter-grade) — the only grade that counts as [Correct](#combo-threshold-grading), gains [co-rating](#co-rating), and clears a [miss](#miss). One threshold unifies grading, rating, and feedback, so "solved" means the same thing everywhere: at or above the win line.

### Graded reward curve

The mapping from a [combo score](#combo-score) to the Glicko [co-rating](#co-rating) outcome (#51, `scoreToOutcome`, `packages/rating/src/glicko.ts`) — the rating signal is the answer's **0–100 quality, not a binary pass/fail**. The [win line](#win-line) (97) maps to **neutral** (0.5, no rating change); above it the curve is gently **convex** to a full win at 100 (98≈0.56, 99≈0.72); below it a **steeper, floored** dock (95≈0.45, ≤82→0.10) — a real miss is docked harder than a near-best is rewarded, floored so one bad answer can't tank a rating. Deliberately chosen over loosening the curve: it keeps steady-state movement stable while the [placement boost](#placement-boost) handles fast early convergence.

### Seed rating

A puzzle's **starting Glicko rating**, derived from generated [difficulty](#difficulty) (harder → higher) rather than a flat default, with the seed [deviation](#co-rating) RD 350. It anchors [matchmaking](#matchmaking) from the very first attempt and is the baseline the [placement boost](#placement-boost) ramps from. Band-aligned seeds: `VERY_EASY_SEED` 1100 / `EASY_SEED` 1300 / `HARD_SEED` 1700 (`difficulty.ts`); the [tetris cap](#difficulty) caps the seed to match the capped band.

### Drill mode

A play mode that **filters the bank to one [type-tag](#puzzle-type-tag) family** (#85) so the player can practice a specific skill — e.g. only `tuck`/`spin` maneuvers, or only `dig` clears. Powered by the per-puzzle tags. A serve-mode sibling of [matchmaking](#matchmaking) and [review misses](#review-misses).

### Due miss

A [miss](#miss) that has **fallen back out of the [anti-repeat window](#anti-repeat-cooldown)** — a miss still inside the window is being served recently enough already, so it is *not* due (`dueMisses`, `packages/data/src/misses.ts`). [Review misses](#review-misses) auto-injects the **oldest due miss** into ~1 of every 10 normal serves (`shouldInjectMiss`, `MISS_INJECT_RATE = 0.1`), so a forgotten miss resurfaces on its own without nagging.

### Continue-as-guest

The explicit **"Continue as guest"** affordance on the sign-in page (`continueAsGuest`, `SignIn.tsx`): start playing without linking an identity. It forces an [anonymous session](#anonymous-session) — Supabase anonymous sign-in, or a local-only guest user if that is disabled — and opens the app gates. Distinct from the *automatic* anonymous session every visitor already gets on load: this is the deliberate **"skip sign-in"** button. A guest can later [link](#anonymous-session) email/Google/Discord, preserving the UID.

### Community-correct percentage

A per-puzzle difficulty signal shown in the [verdict](#verdict)/results (since grill-with-docs #7): **solved ÷ total attempts**, computed **live** at results time (a count over [attempts](#co-rating); the player's own just-finished attempt is included) and shown **always with its sample size — `X% (N)`** so a tiny sample is self-evident. Displayed alongside the puzzle's numeric [co-rating](#co-rating). An empirical complement to the model-based rating; deliberately *not* the [star rating](#star-rating), which is about fun, not difficulty.

### Star rating

A player's **1–5 star "how fun is this puzzle"** judgement, entered in the results section (since grill-with-docs #7). **Quality/fun, deliberately not difficulty** (that is the rating + [community-correct percentage](#community-correct-percentage)). One rating per user per puzzle, **anonymous allowed and changeable** (upsert, own-row RLS). The community **average is hidden until the player has rated**, then revealed (`avg ★ (N)`) to avoid anchoring. The crowd substrate for a future auto-"interestingness" [curation](#curation) gate.

### Matchmaking

Puzzle selection (since 2026-06-21, replacing uniform-random): draw the next puzzle at random from puzzles whose rating is within a **band around the player's rating** (auto-widening if too few), **excluding recently-seen** puzzles. One query delivers both "around my level with some variance" and the [anti-repeat cooldown](#anti-repeat-cooldown). Made meaningful by [difficulty](#difficulty)-seeded puzzle ratings — the PRD had deferred matchmaking precisely because flat seeds carried no signal. Since 2026-06-26 the in-band pick is also **type-de-clustered** ([anti-streak](#anti-streak)) — still random, but biased away from serving the same puzzle type several times running.

### Anti-streak

The type-de-clustering layered on the [matchmaking](#matchmaking) random pick (since 2026-06-26, #99): each of the last few serves that shares a candidate's **headline type** (`dominantTag` — the most-salient of its [type-tags](#puzzle-type-tag) by the fixed `DOMINANT_TAG_PRIORITY` order in `packages/core/src/tags.ts`, or `'plain'` if untagged) down-weights that candidate. The precedence runs **maneuver > clear goal > stacking shape > avoid-dependency**, and *within* those buckets too — maneuvers rank `spintuck` > per-piece spins (`t/s/z/l/j-spin`) > `spin` > `tuck`, and clear goals rank **`dig` > `tetris` > `burn` > `tetris-ready`** (so a puzzle tagged both `dig` and `tetris` headlines as `dig`). so consecutive picks vary by type. Weights stay positive, so a rating band that holds only one type still serves it (**never starves**) — it only spreads types out when alternatives exist. Answers "I keep getting the same puzzle *types* in a row" (the streaks were a statistical artifact of one type dominating a rating band, since type correlates with difficulty — selection was always random, just type-blind). Distinct from the [anti-repeat cooldown](#anti-repeat-cooldown), which excludes the same *puzzle*, not the same *type*.

### Anti-repeat cooldown

A play-side rule folded into [matchmaking](#matchmaking): the player's **200 most-recently-attempted distinct puzzles** are excluded from selection, so a puzzle **returns later but not soon**. Since grill-with-docs #7 (2026-06-23) this is a **persistent** window **derived from the [attempts](#co-rating) log** (not a stored ring), so it survives reloads and carries **session-to-session** per device — and **cross-device** once the account is signed in (see [account linking](#anonymous-session)). [Matchmaking](#matchmaking) widens the rating band to find an *unseen* puzzle before ever relaxing the window. Answers "I keep getting the same puzzles." Distinct from [deduplication](#deduplication), the generation-side guard against near-identical *different* puzzles. (Pre-#7 this was a session-only in-memory ring of the last 10.)

### Miss

A puzzle the player has **attempted but never solved** (no [A+](#letter-grade) attempt). A miss is eligible for [review](#review-misses) and **leaves the miss set the moment it is solved**. The persistent substrate for "go back to the ones you got wrong." Distinct from a merely *seen* puzzle (which may already be solved).

### Review misses

Re-attempting [misses](#miss) (since grill-with-docs #7). Two paths: an explicit **Review-misses** mode that serves unsolved puzzles **oldest-first**, bypassing the [anti-repeat window](#anti-repeat-cooldown) and the rating band; and **auto-injection** of a *due* miss (one that has fallen back out of the window) into ~1 of every 10 normal serves. **Not** the same as [Replay](#replay) — that is the combo *animation* on the feedback board; this is *re-solving* a puzzle you got wrong.

### Anonymous session

Every visitor gets a real Supabase **anonymous** auth session on load, so `auth.uid()` is a genuine UUID that satisfies row-level security and rating writes persist — for dev/local play and the open-access live site alike. Replaces the all-zeros dev-bypass user whose writes RLS silently rejected. The session's rating is portable: linking email/Google/Discord later carries it over. **Account linking (since grill-with-docs #7):** the play app surfaces a "Sign in" affordance that **links** the chosen identity to the existing anonymous user while **preserving the UID**, so the rating, [attempts](#co-rating), prefs, and the [anti-repeat window](#anti-repeat-cooldown) all carry over and become **cross-device**. A verified email obtained this way is also what gates [admin](#admin).

### Admin

A privileged account — exactly the [curation](#curation) powers (flag + soft-delete/cull), renamed from *curator* in grill-with-docs #7. Gated by a **verified-email allowlist** checked in Supabase RLS (`auth.jwt() ->> 'email'` in the allowlist, requiring a verified email and a non-anonymous session), *not* in the client. `jrhsk8@gmail.com` is the first admin. There is one privilege level (no separate super-admin); the email key was chosen over a UID key (brittle across re-auth/providers) so an admin is identified by the email itself.

### Ghost placement

The **single free-floating outline** of a piece that the player pilots to a final resting placement, then confirms. Since grill-with-docs #8 (2026-06-23) there is **exactly one piece representation** — a hollow, colour-coded **outline** that stays exactly where it is piloted (a **free cursor**: no auto-fall, WYSIWYG). It spawns floating at the board's **top row** (un-settled, not above the edge). This **replaced the #81 dual rendering** — a bright *active* piece at the floating row plus a separate muted *drop-shadow* at where it would land — whose two renderings diverged by a row (the "awkward partial ghost one row off the bottom") and read as several ambiguous states; collapsing to one outline deletes that symptom at the root.

- **Two states, one outline.** Hollow while **floating**; outline **+ a glow** the moment it is **resting** (fits and can't fall one row — [`isResting`](#combo-threshold-grading)). The glow is the lock cue: **Confirm is enabled only when resting**, guaranteeing every locked placement is a gradeable [resting placement](#tuck--spin). (Distinct from the feedback view's gold answer-highlight, which is unchanged.)
- **Lateral — tuck-seeking.** A left/right press moves the piece to the **reachable position in the target column nearest the current row, preferring at-or-below** — tucking *into* a pocket when pressed toward one, **riding up** over a wall only when nothing at-or-below is reachable (a press fails only when the column is full to the very top). Height-preserving, so sideways reads as a free glide. (Replaced the grill-with-docs #6 ride-up-to-the-top rule — the "can't tuck the J into the col-4/col-8 holes" report.)
- **Spin — descends into the pocket** (since grill-with-docs #9, 2026-06-25). Rotation holds the **column fixed**, changes orientation, and snaps to the **deepest** reachable state at the new rotation **at-or-below the current row** (screwing the piece *down* into the pocket), riding **up** only when nothing at-or-below is reachable (the floor case). **Descent is unconditional** — rotating in an open column drops the piece to that column's floor; Up lifts it back. This fixes the [t-spin](#t-spin) defect: the earlier **height-preserving** rule (#8 — snap to the *nearest* rotated state) just spun the piece *on the ledge*, so a t-spin needed an undiscoverable rotate→soft-drop→rotate; descending makes it pure **rotate, rotate**. Spin is therefore **no longer the exact twin of the lateral law** — lateral stays height-preserving (a free glide), spin descends (a screw-in). Works for **every** piece (T/S/Z/L/J/I) with **no per-piece kick table** — NES has no SRS/wall kicks, so spins work by rotating at a height where the shape fits, and `reachableStates` already enumerates exactly those.
- **Drop — tap one row, hold to snap** (since grill-with-docs #9). A tap soft-drops exactly one row (fine control); **holding past ~250 ms snaps the piece straight down to its settle row** in the current column (tuck-aware — it stops on top of an overhang). The #89 per-row auto-repeat is **removed**; Up raises one row (to lift off the floor to spin); there is no discrete hard-drop *button*. With no [landing projection](#ghost-placement), dropping is also how the player sees where the piece lands. (This re-permits a snap-to-bottom — gated behind a hold delay, not a teleport button — softening #8's strict "nothing teleports.")
- **Touch.** Same positioning via **drag anywhere on the board** (finger column → piece column) with ▲/▼ soft-drop for depth, committed by an explicit **Confirm** button.

A **landing projection** (a faint colour-coded shadow of where the floating piece would rest, `landingCells`) was added in #89 and **removed again in grill-with-docs #9** ("get rid of the ghost piece entirely") — the single piloted outline is once more the *only* piece rendering during placement, restoring the #8 one-outline model. ("Ghost piece" colloquially meant that landing projection, **not** this piloted outline, which is the input itself and cannot be removed.)

The model and input remain **navigation-complete**: every move and spin snaps only to states in the generator's BFS `reachableStates`, and locking only ever happens at a resting position — exactly `enumerateResting` — so the player can never confirm a placement the generator did not enumerate (the superset binding invariant, [tuck / spin](#tuck--spin)), and tucks/spins stay first-class. There is no timer — input is "pick a resting placement," not real-time play. (Not the standard hard-drop drop-shadow that "ghost" usually means in Tetris. 2026-06-25 #9: spin descends into the pocket, hold-to-snap drop, landing projection removed. 2026-06-23 #8: collapsed to one free-floating outline (resting-glow, spin-anywhere, no drop-shadow). 2026-06-23 #7: lateral narrowed to tuck-seeking. 2026-06-22: lateral changed from collision-gated to free/ride-up. 2026-06-21: was hard-drop / column-only, which couldn't express tucks.)

### Current piece / next piece

The piece being placed now, and the lookahead piece. Placement 1 shows both; the next piece is then placed as the second piece, shown with no further lookahead. **Both are always placed** — there is no short-circuit on a wrong first placement.

### The bank

The set of puzzles that have survived the quality gates and are stored complete in Supabase — so the play app needs nothing from the engine. Produced offline; the play app only ever reads it. Each entry stores the board, both pieces, the [optimal line](#optimal-line), precomputed optimal metrics, a starting rating, the [color grid](#color-grid), and (since the 2026-06-20 combo overhaul) the [combo table](#combo-table).

### Next box

The NES-style bordered preview of the next piece, drawn as a real piece graphic in its spawn orientation and color, top-right of the board. Empty on placement 2 (no lookahead). The [current piece](#current-piece--next-piece) is not boxed — it is the on-board [ghost placement](#ghost-placement).

### Color grid

A per-cell color-group encoding stored alongside the binary board (a 200-char string: `'0'` empty, `'1'/'2'/'3'` = NES color group) so the existing stack renders in authentic NES colors. Kept separate from the binary `Grid` so metrics, the checker, and placement logic stay color-blind. Produced by color-tracking self-play during generation. Consumed by both the solving board and the (now color-aware) [replay](#replay), so the stack never reverts to white.

### Screenshot submission

A front-end affordance (new for 2026-06-21) letting players contribute puzzles, **screenshot-only to start**. Because solving requires [StackRabbit](#stackrabbit) — offline-only, never deployed — the browser merely **uploads the image to a submission queue**; the offline pipeline **OCRs the NES grid into board + pieces, solves, runs the gates / [dedup](#deduplication) / [difficulty](#difficulty), and banks or rejects** it. Submitted puzzles go live after the next generation run. A second implementation of the pluggable [board source](#self-play--board-source), alongside self-play.

### Curation

A dev-only "is it fun?" pass over [the bank](#the-bank), done **in situ during normal play** (new for grill-with-docs #6, 2026-06-22) — the human axis on top of the automated correctness / cleanliness / [consensus](#consensus-gate) gates. An **allowlisted [admin](#admin)** account (the *curator* role — renamed **admin** and gated by a **verified-email** allowlist in RLS since grill-with-docs #7, reachable now that [sign-in / linking](#anonymous-session) exists; still enforced in Supabase RLS *not* the client, since the bank is shared by every player) gets two actions while playing: **flag** — attach a free-text **comment**, appended to an append-only `puzzle_flags` log (action `flag`), so later review can mine *what makes puzzles boring*; and **soft-delete** (cull) — write a `cull` log row (with an optional reason) and set the puzzle's `active` flag false, so [matchmaking](#matchmaking) drops it immediately while the row, [combo table](#combo-table), and [attempts](#co-rating) survive (reversible — a misclick mid-play is recoverable). Curation is **organic**: the bank is grown large, but a curator only ever reaches the puzzles matchmaking serves them, so pruning is best-effort over time, never an exhaustive sweep (no systematic review mode, by choice).
