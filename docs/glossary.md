# Glossary — Ubiquitous Language

Shared vocabulary for the NES Tetris Stacking Trainer. Terms here are used verbatim in code, docs, and conversation. Full context: [PRD-v1.md](PRD-v1.md).

### Stacking

The judgment of *where* to place each piece — the skill the trainer measures — including higher-level line-clear strategy (burn-vs-build, tetris setup), not just where a single piece sits. Deliberately separated from execution (tapping/DAS speed).

### Piece / next-piece puzzle

The puzzle unit: a board plus the current piece and the next piece. The player places the current piece (knowing the next), then places the next piece — **placing both regardless of whether the first was optimal** (since the 2026-06-20 combo overhaul). The answer is graded as a [two-piece combo](#two-piece-combo).

### Two-piece combo

A specific pair of placements `(placement₁, placement₂)` — the player's full answer to a puzzle. Its value is StackRabbit's evaluation of the board after **both** pieces are placed. A puzzle's universe of answers is the cross-product of every legal first placement × every legal second placement on the board that first placement produces.

### Optimal line

The best (rank-1) [two-piece combo](#two-piece-combo) for a puzzle — the highest-scoring pair. Still the headline answer, but grading is now by [combo score](#combo-score) threshold rather than exact match.

### Combo score

A [two-piece combo](#two-piece-combo)'s value field-normalized to **0–100** across the puzzle's evaluated combos (best = 100, worst legal = 0), computed at generation. It is the number shown beside each combo in feedback and the basis for grading. Combos too bad to rank (beyond the stored top-K) are off-scale.

### Combo-threshold grading

v2 grading (replaces the v1 [exact-match checker](#exact-match-checker)). The player always places both pieces; the attempt is scored by its [combo score](#combo-score). An attempt is **Correct** iff its combo scores **≥ 95** (within 5% of the best combo), else **Incorrect**. There is no first-move short-circuit — a weak first move simply caps the combo's score. Drives the [verdict](#verdict) and the binary solved/failed signal for [co-rating](#co-rating).

### Exact-match checker

v1 grading, **superseded** by [combo-threshold grading](#combo-threshold-grading). The player had to match the optimal first *and* second placement (match = same final resting column + rotation); a wrong first placement failed the puzzle immediately and revealed the optimal line, with no separate grading of move 2.

### Verdict

The prominent **Correct / Incorrect** banner shown after an attempt (alongside the combo's 0–100 score), so the outcome is unmistakable. Answers the old complaint that nothing made clear what happened after you entered your answer.

### Combo table

The per-puzzle store of the **top-K (K ≈ 30) ranked two-piece combos** — each combo's placements and [combo score](#combo-score), plus the total count of ranked combos. Generation evaluates the full cross-product to rank and normalize, but persists only the top-K, so rows stay small and the play app needs no live engine. Replaces the v1 [value tables](#value-table).

### Value table

v1 data, **superseded** by the [combo table](#combo-table). Two independent per-piece lists (`first_values` over all legal piece-1 placements; `second_values` over all legal piece-2 placements on the board after the optimal first move). No cross-product existed, because v1 ended the puzzle on a wrong first move.

### Ranked combo list

The post-attempt feedback display (replaces the v1 [solutions chart](#solutions-chart)): a stacked, ranked list of the **top-5** combos with their 0–100 [scores](#combo-score). The player's combo is highlighted if it is among the top-5; otherwise it appears in a row below — with its exact rank + score if it ranks 6–K, or marked **"too low to rank"** if it falls beyond the stored top-K. Rows are **interactive**: selecting one animates that combo on the central board (the [replay](#replay) parameterized by `(p1, p2)`); the player's own move is selected by default.

### Solutions chart

v1 feedback display, **superseded** by the [ranked combo list](#ranked-combo-list). Two per-piece value distributions drawn as strip plots (a dot per legal placement, ★ = optimal, ● = the player's move, with a rank callout).

### Board-health floor

A generation gate (R3) for cleaner *starting* boards: keep a candidate snapshot only if the **minimum best-move value across all 7 piece types** clears a moderate, tunable floor — a piece-independent proxy for "a board StackRabbit rates highly," since StackRabbit exposes no static board evaluation. A cheap [geometric](#geometric-metrics) pre-filter (holes/bumpiness) drops obvious garbage before the engine calls. Runs before the combo sweep.

### Unambiguity gate (fairness gate)

v1 generation filter, **dropped** for combo grading on 2026-06-20. It kept a candidate only if the best line beat the second-best by a large margin on both placements, to make exact-match grading fair. [Combo-threshold grading](#combo-threshold-grading) needs no unique best, so the gate was removed; board quality is now ensured by the [board-health floor](#board-health-floor) and meaningfulness by the ≥95 bar (accepted risk: an occasional trivially-passable puzzle).

### Hz-invariance

A generation filter: keep a candidate only if its **best combo** is identical across the full range of piece-movement speeds (slowest tap to fastest DAS). Makes a puzzle **movement/reaction agnostic** — its answer never depends on execution speed, only on stacking judgment. (Retargeted from "optimal move per ply" to "best combo" in the 2026-06-20 combo overhaul.)

### Slow-tap / fast-DAS

The two extremes of piece-movement speed: slowest manual tapping vs. fastest DAS (Delayed Auto Shift — the auto-repeat when a direction is held). The endpoints checked for [Hz-invariance](#hz-invariance).

### Geometric metrics

Board measures: **holes** (empty cells with a filled cell somewhere above), **bumpiness** (sum of height differences between adjacent columns), and **height** (the stack's overall height). Used in the generator's [board-health](#board-health-floor) pre-filter and to precompute optimal-side metrics; the player-side values are computed client-side. Not shown to the player (feedback is the [ranked combo list](#ranked-combo-list)).

### Self-play / board source

Generation sources candidate boards via simulated semi-random self-play (mostly-optimal policy with occasional injected suboptimal moves), snapshotted at a random mid-game point. The board source is a pluggable interface; self-play is the only v1 implementation, with real-gameplay extraction anticipated behind the same interface. (The injected-noise rate may be lowered to feed the [board-health floor](#board-health-floor) cleaner candidates.)

### StackRabbit

The local NES Tetris AI engine that evaluates moves ([github.com/GregoryCannon/StackRabbit](https://github.com/GregoryCannon/StackRabbit)). Used only in the offline generator. Never deployed, never queried at play time. Scores *moves* (placements with lookahead); it has **no static whole-board rating** — hence the piece-averaged [board-health floor](#board-health-floor) proxy.

### Replay

The post-attempt animation on the central board: a piece spawns at top-center, performs one eased rotate-and-slide during the upper part of the fall, then drops straight to rest (clip-checked, with a flash-and-collapse on a line clear; honors `prefers-reduced-motion`). Now **color-aware** (base = the puzzle's [color grid](#color-grid); each dropped piece paints its NES color group) and **parameterized by combo** — it can animate any combo selected in the [ranked combo list](#ranked-combo-list), not just the optimal line.

### Co-rating

Both players and puzzles carry a Glicko-2 rating (rating + deviation + volatility). Solving a higher-rated puzzle raises yours; failing lowers it. "Solved" = the attempt's [combo score](#combo-score) ≥ 95. Puzzle ratings drift toward true difficulty as attempts accumulate.

### Ghost placement

The movable translucent preview of a piece that the player positions to a final resting placement, then confirms. Input is "pick a resting placement," not real-time play. (Not the standard hard-drop drop-shadow that "ghost" usually means in Tetris.)

### Current piece / next piece

The piece being placed now, and the lookahead piece. Placement 1 shows both; the next piece is then placed as the second piece, shown with no further lookahead. **Both are always placed** — there is no short-circuit on a wrong first placement.

### The bank

The set of puzzles that have survived the quality gates and are stored complete in Supabase — so the play app needs nothing from the engine. Produced offline; the play app only ever reads it. Each entry stores the board, both pieces, the [optimal line](#optimal-line), precomputed optimal metrics, a starting rating, the [color grid](#color-grid), and (since the 2026-06-20 combo overhaul) the [combo table](#combo-table).

### Next box

The NES-style bordered preview of the next piece, drawn as a real piece graphic in its spawn orientation and color, top-right of the board. Empty on placement 2 (no lookahead). The [current piece](#current-piece--next-piece) is not boxed — it is the on-board [ghost placement](#ghost-placement).

### Color grid

A per-cell color-group encoding stored alongside the binary board (a 200-char string: `'0'` empty, `'1'/'2'/'3'` = NES color group) so the existing stack renders in authentic NES colors. Kept separate from the binary `Grid` so metrics, the checker, and placement logic stay color-blind. Produced by color-tracking self-play during generation. Consumed by both the solving board and the (now color-aware) [replay](#replay), so the stack never reverts to white.
