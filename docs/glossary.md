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

The set of puzzles that have survived both quality gates and are stored complete in Supabase — so the play app needs nothing from the engine. Produced offline; the play app only ever reads it. Each entry stores the board, both pieces, the optimal line, precomputed optimal metrics, and a starting rating.

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

Board measures shown as deltas after an attempt: **holes** (empty cells with a filled cell somewhere above), **bumpiness** (sum of height differences between adjacent columns), and **height** (the stack's overall height). Optimal-side values are precomputed at generation; player-side values are computed client-side from the player's board.

### Self-play / board source

Generation sources candidate boards via simulated semi-random self-play (mostly-optimal policy with occasional injected suboptimal moves), snapshotted at a random mid-game point. The board source is a pluggable interface; self-play is the only v1 implementation, with real-gameplay extraction anticipated behind the same interface.

### StackRabbit

The local NES Tetris AI engine that evaluates moves ([github.com/GregoryCannon/StackRabbit](https://github.com/GregoryCannon/StackRabbit)). Used only in the offline generator. Never deployed, never queried at play time.
