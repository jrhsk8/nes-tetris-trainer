# PRD — NES Tetris Stacking Trainer (v1)

> Status: Draft for implementation. Net-new project (no prior code).
> Engine prerequisite (StackRabbit) already runs locally as an **offline** tool.
> Companion context: handoff notes for the puzzle site and for the StackRabbit setup.

---

## Problem Statement

I want to get better at NES Tetris **stacking** — the judgment of *where to put each piece* — but there is no focused way to practice that skill in isolation. Playing real games conflates stacking judgment with execution speed (tapping/DAS), and watching the StackRabbit AI play tells me the answer without making me *earn* it. I have no objective measure of whether my stacking is actually improving over time.

I want a trainer that:

1. Hands me realistic mid-game positions and asks me to make the *best stacking decision*, not to move pieces fast.
2. Tells me whether I was right, and shows me the better line when I'm wrong.
3. Tracks my stacking skill as a single number that visibly goes up as I improve, so I can see progress.

There is no codebase yet. The StackRabbit engine is already installed and queryable locally, but only as a backend evaluation tool — it does not play a live game and is never deployed to users.

## Solution

A public, deployed, multi-user web app — the **NES Tetris Stacking Trainer** — that serves **pre-generated** two-placement puzzles and tracks each player's stacking skill with a **Glicko co-rating** (both players and puzzles hold a rating; solving a higher-rated puzzle raises yours, failing lowers it).

The core play loop:

1. The app shows a board plus the **current piece** and the **next piece**.
2. The player positions a **ghost** of the current piece to its final resting placement and confirms (knowing the next piece).
3. The app then shows the same board with the current piece locked in and the **second piece** as the new current piece — **with no further next piece visible** — and the player places it.
4. The app grades the two placements against the stored optimal line, updates the player's rating, and gives feedback: it **animates the optimal line** and shows **geometric metric deltas** (holes / bumpiness / height) comparing the player's result to the optimal result.

Crucially, puzzles test **judgment, not execution**: only puzzles whose optimal answer is identical across *all* piece-movement speeds are ever shown, so there is never a "you needed a fast tuck" answer.

Puzzles are **batch-generated offline** by a separate developer-run tool that drives the local StackRabbit engine, filters for quality, and writes a finished bank into the database. The play app only ever reads that finished bank — it never runs the engine or generates puzzles at play time. The two halves (generation and play) are fully decoupled.

v1 is explicitly a **working prototype of this core loop**, built to answer the real product risk — *are engine-generated positions actually good, fun, instructive puzzles, and does the rating feel meaningful?* — before investing in product polish.

---

## User Stories

### Player — core loop

1. As a player, I want to see a board with the current piece and the next piece, so that I can plan a two-piece sequence.
2. As a player, I want to position a translucent ghost of the current piece by moving and rotating it to a final resting spot, so that I can express my intended placement without needing to play in real time.
3. As a player, I want to confirm my placement, so that the piece locks into the board and I move to the second piece.
4. As a player, I want the second piece presented as the new current piece with no next piece shown, so that the puzzle mirrors how lookahead actually works in a real game.
5. As a player, I want to place the second piece the same way (ghost + confirm), so that I complete the two-ply puzzle.
6. As a player, I want to be told immediately whether I solved the puzzle, so that I get a clear win/loss outcome.
7. As a player, I want a wrong first placement to end the puzzle and reveal the correct line, so that I'm not graded on a second move that no longer makes sense.
8. As a player, I want to watch the optimal two-ply line animate on the board, so that I can see the better sequence even when (especially when) I got it wrong.
9. As a player, I want to see how my result compares to the optimal on simple board metrics (holes, bumpiness, height), so that I understand *what* my placement cost me.
10. As a player, I want to advance to the next puzzle easily, so that I can practice in a continuous flow.

### Player — rating & progress

11. As a player, I want a single skill rating, so that I have one number that represents my stacking ability.
12. As a player, I want my rating to go up when I solve harder puzzles and down when I fail, so that the number reflects real performance.
13. As a player, I want my rating change shown after each puzzle, so that I get immediate reinforcement.
14. As a player, I want my rating to persist across sessions and devices, so that I can track improvement over time.
15. As a player, I want to see my rating history / trend, so that I can confirm I'm actually improving.

### Player — account

16. As a player, I want to create an account, so that my rating and progress are saved to me.
17. As a player, I want to sign in with email, so that I can use the app without a third-party account.
18. As a player, I want to sign in with Google or Discord, so that I can start quickly with an account I already have (the NES Tetris community lives on Discord).
19. As a player, I want to sign out and back in on another device and keep my rating, so that my progress is portable.

### Developer / operator — generation

20. As the operator, I want to run an offline script that drives my local StackRabbit engine, so that I can generate puzzles in batches without deploying the engine.
21. As the operator, I want the generator to produce *realistic* mid-game boards by simulating semi-random play, so that puzzles resemble positions real players actually reach.
22. As the operator, I want the generator to inject occasional suboptimal moves during self-play, so that the resulting stacks contain the kinds of imperfections that make interesting puzzles.
23. As the operator, I want each candidate snapshotted at a random mid-game point, so that puzzles span a range of board states rather than only clean early stacks.
24. As the operator, I want the generator to discard ambiguous positions (where the best line is not clearly better than the second-best), so that exact-match grading is fair.
25. As the operator, I want the generator to discard positions whose optimal answer changes with movement speed, so that every shipped puzzle tests judgment rather than execution.
26. As the operator, I want each stored puzzle to include the board, both pieces, the optimal two-ply line, the precomputed metrics of the optimal result, and a starting rating, so that the play app needs nothing from the engine at runtime.
27. As the operator, I want the board source to be pluggable, so that I can later add real-gameplay-derived positions without rewriting the pipeline.
28. As the operator, I want to write a finished bank of a few hundred puzzles into the database, so that random selection does not repeat quickly.
29. As the operator, I want to confirm the engine's board encoding/orientation before trusting generated data, so that I don't ship a bank built on a flipped board.

### System — selection & grading

30. As the system, I want to select puzzles randomly/sequentially from the bank in v1, so that play works before puzzle ratings are calibrated by a crowd.
31. As the system, I want to grade an attempt by exact-matching the player's final resting placements (column + rotation) against the stored optimal line on both plies, so that grading never depends on input reachability.
32. As the system, I want to start every puzzle at a flat seed rating, so that puzzle difficulty can later be learned purely from aggregate player results.
33. As the system, I want to update both the player's and the puzzle's rating after each attempt via a standard Glicko-2 calculation, so that the co-rating can self-calibrate once there is traffic.
34. As the system, I want to record every attempt (who, which puzzle, what they played, solved or not), so that puzzle ratings can drift toward true human difficulty over time.

---

## Implementation Decisions

### Architecture: two fully-decoupled halves

- **Offline generation pipeline** (developer-run, on a machine with local StackRabbit). Produces a finished puzzle bank and writes it into the database. The engine is used *only* here and is **never deployed**.
- **Play application** (public, multi-user, static front end + hosted database). Reads the finished bank. Never runs the engine and never generates puzzles at runtime.

### Stack

- **Front end:** a plain **React single-page app** (not Next.js), built to **static assets** and self-hosted on **GitHub Pages or the owner's own domain** (explicitly **not** Vercel).
- **Back end services:** **Supabase** for **Postgres + Auth** only. No custom server functions in v1; grading and rating computation run client-side and write results to Supabase.
- **Rating:** a **Glicko-2** library from npm, called client-side. The custom code is only the *glue* mapping a puzzle outcome to a Glicko match result and persisting it.
- **Generator:** an offline **Node** script.
- **Guiding principle:** use off-the-shelf solutions for everything *except* the puzzle-specific code (board, generator, quality filters, checker, rating glue). Those are the only modules worth building by hand.

### The puzzle unit (2-ply)

- A puzzle presents a board, a current piece, and a next piece. The player places the current piece (with knowledge of the next), then places the second piece **with no further lookahead**.
- The stored solution is the **optimal two-placement line**. Because the engine returns a single best placement per query, the line is built from **two sequential engine queries**: best placement for (board, piece1, piece2), then best placement for (resulting board, piece2, *no next*).

### Hz-invariance (replaces choosing a default input timeline)

- Only puzzles whose optimal answer is **identical across the full range of piece-movement speeds** are shipped. Concretely, the generator evaluates the optimal move at a **slow-tap** timeline and a **fast-DAS** timeline and keeps the candidate only if the returned placement is the same.
- Effect: no puzzle's answer ever depends on execution speed; the trainer measures stacking judgment only. This also removes reachability from the input problem — the player selects a resting placement, and grading compares resting placements.

### Generation pipeline

1. **Source candidate boards** via simulated **semi-random self-play**: the engine plays from empty using a mostly-optimal policy with occasionally injected suboptimal/random legal moves, accumulating realistic imperfections; snapshot at a random mid-game point.
2. For each candidate, query the engine to build the **optimal two-ply line** and the **second-best** alternatives needed for the quality gate.
3. **Unambiguity (fairness) gate:** keep a candidate only if the best line beats the second-best by a large `totalValue` margin, applied to **both plies**. (This gate exists so exact-match grading is fair; it is *not* the difficulty signal.)
4. **Hz-invariance gate:** keep only candidates whose optimal move is identical at slow-tap and fast-DAS.
5. **Persist** the surviving puzzle: board, piece1, piece2, optimal two-ply line, precomputed optimal-result metrics, and a **flat seed rating**.
- The **board source is an abstraction**; self-play is the only implementation in v1, with real-gameplay extraction anticipated as a later implementation behind the same interface.

### Checker (v1)

- **Exact-match, solve-the-whole-line.** The player must match the optimal **first** placement *and* the optimal **second** placement; matching means same final resting **column + rotation**.
- A wrong first placement **fails the puzzle immediately** and reveals the correct line (the second move is not separately graded, since the optimal second move assumed the optimal first move).
- This is explicitly a prototype checker. Tolerance-based grading ("within X% of optimal `totalValue`") and adaptive per-move judging are deferred.

### Rating

- **Glicko-2 co-rating.** Players and puzzles both carry a rating, deviation, and volatility.
- **Flat seed:** every puzzle starts at the same rating; difficulty is *not* derived from engine signals in v1. Puzzle ratings drift only from aggregate player results, which accumulate via recorded attempts.
- **Consequence baked into v1:** because seeds are flat and uncalibrated, **puzzle selection is random/sequential** — there is no rating-matched serving until a crowd has generated enough results.
- **No anti-cheat** in v1 (accepted: niche audience, low incentive). Grading and rating computation run client-side and write straight to Supabase.

### Feedback after an attempt

- Show win/loss and the rating change.
- **Animate** the stored optimal two-ply line on the board.
- Show **geometric metric deltas** — holes, bumpiness, height — comparing the player's resulting board to the optimal resulting board. The optimal-side metrics are **precomputed at generation** and stored; the player-side metrics are **computed client-side in plain JS** from the player's board (no engine needed).
- The player's `totalValue` percentage-of-optimal is **deferred** (it requires a live engine, which arrives with tolerance mode). Natural-language "why" explanations are deferred.

### Auth (default, confirmable)

- Supabase Auth with **email** plus **OAuth (Google and Discord)**.

### Data model (sketch)

- **puzzles:** board, piece1, piece2, optimal line, precomputed optimal metrics, rating + deviation + volatility.
- **user_ratings:** user, rating + deviation + volatility.
- **attempts:** user, puzzle, the line the player played, solved/not, timestamp — the substrate from which puzzle ratings later drift.

### Deep modules (the custom surface to build carefully)

- **Engine client** — wraps the local engine's HTTP endpoints and the 200-char board encoding behind a typed "give me the best move / score this move" interface; offline only; hides encoding and the confirmed board orientation.
- **Board model & metrics** — pure functions over a board grid: encode/decode, apply a placement, and compute holes / bumpiness / column heights. Used both offline (store optimal metrics) and in the client (player-move metrics). No engine dependency.
- **Self-play generator** — turns a noisy self-play policy into candidate boards via mid-game snapshots, behind a pluggable board-source interface.
- **Quality filters** — pure predicates over engine outputs: unambiguity (both plies) and Hz-invariance.
- **Checker** — pure exact-match, whole-line grading of an attempt against an optimal line.
- **Rating glue** — a thin wrapper translating a puzzle outcome into a Glicko-2 update and persisting it.

---

## Testing Decisions

**Governing principle (project-wide):** prefer **deep tests that exercise entire end-to-end user interactions** over isolated unit tests of individual small features. A good test asserts **external, user-visible behavior** — what the player or operator observes — not internal implementation details, so the tests survive refactors of how a module works internally.

Primary test surfaces:

1. **Play-flow interaction test (end-to-end):** starting from a stored puzzle, drive the full loop — present board + pieces → place piece 1 → place piece 2 → grade → rating update → feedback — and assert the observable outcomes (solved/failed correctly, rating moved in the right direction, optimal line and metric deltas surfaced). This single flow exercises the checker, board metrics, and rating glue through real usage rather than in isolation.
2. **Generation pipeline test (end-to-end / integration):** drive the pipeline — generate candidates → apply unambiguity and Hz-invariance filters → assemble and store a puzzle — and assert that only fair, Hz-invariant puzzles with complete stored data survive. Where it needs the engine, this runs as an **integration smoke test against a live local StackRabbit**.
3. **Focused tests for intricate pure logic** where a full flow can't pin down a subtle rule cheaply: the unambiguity threshold behavior, the Hz-invariance agreement check, exact-match edge cases (e.g. wrong first move ends the puzzle), and board-metric correctness (including an encode↔decode round-trip). These exist to nail behavior the broader flows can't isolate — not to test internals for their own sake.

The engine client, the self-play randomness, and the React view layer are **not** unit-targeted: the engine client is I/O (covered via the integration smoke test), the self-play policy is stochastic (its *filters* are tested, not its randomness), and the UI is exercised through the play-flow interaction test.

Prior art: none yet (net-new project); these conventions are established here.

---

## Out of Scope (v1)

- **Tolerance-based / graded scoring** ("within X% of optimal `totalValue`") and **adaptive per-move judging** — v1 is exact-match, solve-the-whole-line.
- **Live engine at play time** — v1 grades against stored solutions only; the player's `totalValue`% comparison waits for tolerance mode.
- **Real-gameplay-derived boards** — anticipated behind the pluggable board source, but v1 ships self-play only.
- **Rating-matched puzzle selection / matchmaking** — v1 serves random/sequential because flat seeds aren't yet calibrated.
- **Difficulty display** beyond the rating number — no tiers, badges, or per-skill mastery in v1.
- **Natural-language explanations** of why the optimal line is better.
- **Additional puzzle types** — survival/dig, tuck/spin-required, burn-vs-build, deeper lookahead. v1 is the single 2-ply "best line" type.
- **Anti-cheat / server-side trust boundary** — explicitly accepted as out of scope.
- **Product shell** — daily puzzles, streaks, shareable results, leaderboards, social features.
- **Engine deployment** — the engine stays an offline generation tool.

---

## Further Notes

- **Build order suggestion:** (1) engine client + board model with the board-orientation check; (2) self-play generator + the two quality filters, producing a small bank; (3) play app — board render, ghost input, checker, feedback — reading that bank from Supabase; (4) rating glue + auth + persistence; (5) scale the bank to a few hundred puzzles.
- **The real risk v1 must retire** is *puzzle quality*: do self-play snapshots that survive the filters feel like good, instructive puzzles to a human? Generate a small batch and play them before scaling.
- **Board-orientation caveat:** confirm the engine's `parseBoard` row orientation before trusting any generated bank — a flipped board silently corrupts every puzzle.
- **Co-rating cold start:** with flat seeds and (initially) little traffic, puzzle ratings stay near the seed and the player's rating moves against a roughly uniform field. This is acceptable for the prototype; matchmaking and meaningful puzzle difficulty emerge once attempts accumulate.
- **Fairness coupling:** the unambiguity gate and the exact-match checker are coupled — tightening the gate is what makes exact-match fair. If the gate is loosened later, the checker must move to tolerance at the same time.
