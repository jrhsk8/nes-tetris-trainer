# Glossary — Ubiquitous Language

Shared vocabulary for the NES Tetris Stacking Trainer. Terms here are used verbatim in code, docs, and conversation. Full context: [PRD-v1.md](PRD-v1.md).

### Stacking

The judgment of *where* to place each piece — the skill the trainer measures — including higher-level line-clear strategy (burn-vs-build, tetris setup), not just where a single piece sits. Deliberately separated from execution (tapping/DAS speed).

### Piece / next-piece puzzle

The puzzle unit: a board plus the current piece and the next piece. The player places the current piece (knowing the next), then places that next piece as the new current piece with no further lookahead. Graded against the optimal line.

### Optimal line

The stored optimal pair of placements for a puzzle, against which an attempt is graded.

### Ghost placement

The movable translucent preview of a piece that the player positions to a final resting placement, then confirms. Input is "pick a resting placement," not real-time play. (Not the standard hard-drop drop-shadow that "ghost" usually means in Tetris.)

### Current piece / next piece

The piece being placed now, and the lookahead piece. Placement 1 shows both; the next piece then becomes the current piece for placement 2, shown with no further lookahead.

### The bank

The set of puzzles that have survived both quality gates and are stored complete in Supabase — so the play app needs nothing from the engine. Produced offline; the play app only ever reads it. Each entry stores the board, both pieces, the optimal line, precomputed optimal metrics, a starting rating, and (since the 2026-06-20 overhaul) the [color grid](#color-grid) and the [value tables](#value-table).

### Co-rating

Both players and puzzles carry a Glicko-2 rating (rating + deviation + volatility). Solving a higher-rated puzzle raises yours; failing lowers it. Puzzle ratings drift toward true difficulty as attempts accumulate.

### Unambiguity gate (fairness gate)

A generation filter: keep a candidate only if the best line beats the second-best by a large `totalValue` margin on both placements. Makes exact-match grading fair. Coupled to the checker — loosening it requires moving the checker to tolerance.

### Hz-invariance

A generation filter: keep a candidate only if its optimal move is identical across the full range of piece-movement speeds (slowest tap to fastest DAS). Makes a puzzle **movement/reaction agnostic** — its answer never depends on execution speed, only on stacking judgment.

### Slow-tap / fast-DAS

The two extremes of piece-movement speed: slowest manual tapping vs. fastest DAS (Delayed Auto Shift — the auto-repeat when a direction is held). The endpoints checked for Hz-invariance.

### Exact-match checker

v1 grading: the player must match the optimal first *and* second placement, where match = same final resting **column + rotation**. A wrong first placement fails the puzzle immediately and reveals the optimal line (the optimal second move assumed the optimal first, so move 2 is not separately graded).

### Geometric metrics

Board measures: **holes** (empty cells with a filled cell somewhere above), **bumpiness** (sum of height differences between adjacent columns), and **height** (the stack's overall height). Optimal-side values are precomputed at generation; player-side values are computed client-side from the player's board. As of the 2026-06-20 overhaul these are no longer shown to the player (the feedback display was replaced by the [solutions chart](#solutions-chart)); the functions remain because the generator still uses them.

### Self-play / board source

Generation sources candidate boards via simulated semi-random self-play (mostly-optimal policy with occasional injected suboptimal moves), snapshotted at a random mid-game point. The board source is a pluggable interface; self-play is the only v1 implementation, with real-gameplay extraction anticipated behind the same interface.

### StackRabbit

The local NES Tetris AI engine that evaluates moves ([github.com/GregoryCannon/StackRabbit](https://github.com/GregoryCannon/StackRabbit)). Used only in the offline generator. Never deployed, never queried at play time.

### Solutions chart

The post-attempt feedback display (replaced the [geometric metrics](#geometric-metrics) table on 2026-06-20). Two per-piece **value distributions** drawn as strip plots: every legal placement of the piece is a dot positioned by its engine value (field-normalized 0–100), with the [optimal line](#optimal-line)'s placement (★) and the player's placement (●) marked, plus a rank callout ("5th of 17"). Piece-1 covers all its legal placements; piece-2 covers all its legal placements on the board *after the optimal first move* — a wrong first move ends the puzzle, so no cross-product is needed.

### Value table

The per-placement engine values precomputed at generation and stored with each puzzle (`first_values`, `second_values`) so the [solutions chart](#solutions-chart) needs no live engine. One entry per legal placement: its rotation, column, and StackRabbit value.

### Next box

The NES-style bordered preview of the next piece, drawn as a real piece graphic in its spawn orientation and color, top-right of the board. Empty on placement 2 (no lookahead). The [current piece](#current-piece--next-piece) is not boxed — it is the on-board [ghost placement](#ghost-placement).

### Color grid

A per-cell color-group encoding stored alongside the binary board (a 200-char string: `'0'` empty, `'1'/'2'/'3'` = NES color group) so the existing stack renders in authentic NES colors. Kept separate from the binary `Grid` so metrics, the checker, and placement logic stay color-blind. Produced by color-tracking self-play during generation.
