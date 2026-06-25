# PRD — NES Tetris Stacking Trainer (v1)

> The v1 spec. Implemented and live; later decisions that supersede parts of this
> doc are logged in [decisions.md](decisions.md) (noted inline where they apply).
> Engine prerequisite (StackRabbit) runs locally as an **offline** tool.

---

## Problem Statement

I want to get better at NES Tetris **stacking** — the judgment of *where to put each piece* — but there is no focused way to practice that skill in isolation. Playing real games conflates stacking judgment with execution speed (tapping/DAS), and watching the StackRabbit AI play tells me the answer without making me *earn* it. I have no objective measure of whether my stacking is actually improving over time.

I want a trainer that:

1. Hands me realistic mid-game positions and asks me to make the *best stacking decision*, not to move pieces fast.
2. Tells me whether I was right, and shows me the better line when I'm wrong.
3. Tracks my stacking skill as a single number that visibly goes up as I improve, so I can see progress.

The StackRabbit engine is used as a backend evaluation tool only — it does not play a live game and is never deployed to users.

## Solution

A public, deployed, multi-user web app — the **NES Tetris Stacking Trainer** — that serves **pre-generated** two-placement puzzles and tracks each player's stacking skill with a **Glicko co-rating** (both players and puzzles hold a rating; solving a higher-rated puzzle raises yours, failing lowers it).

The core play loop:

1. The app shows a board plus the **current piece** and the **next piece**.
2. The player positions a **ghost** of the current piece to its final resting placement and confirms (knowing the next piece).
3. The app then shows the same board with the current piece locked in and the **second piece** as the new current piece — **with no further next piece visible** — and the player places it.
4. The app grades the two placements as a combo (score 0–100, letter grade); updates the player's rating; and gives feedback: it animates the optimal line and shows a ranked combo list with scores.

> **Superseded:** feedback is now a [letter grade](glossary.md#letter-grade) + [ranked combo list](glossary.md#ranked-combo-list), not geometric metric deltas. See [decisions.md](decisions.md) (2026-06-20 combo-grading overhaul, 2026-06-22 grill-with-docs #5).

Crucially, puzzles test **judgment, not execution**: only puzzles whose optimal answer is identical across *all* left/right movement speeds are ever shown. Tuck/spin capability is granted — there *can* be a tuck or spin answer, but the player is never tested on execution speed.

> **Superseded:** "there is never a tuck answer" was the v1 rule. Since the 2026-06-21 v2 overhaul, tucks and spins are [first-class](glossary.md#tuck--spin). Hz-invariance is narrowed to left/right traverse speed only; tuck/spin reachability is assumed.

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
7. ~~As a player, I want a wrong first placement to end the puzzle and reveal the correct line, so that I'm not graded on a second move that no longer makes sense.~~ **Superseded:** both pieces are always placed; grading is by [combo-threshold](glossary.md#combo-threshold-grading) on the full two-piece combo.
8. As a player, I want to watch the optimal two-ply line animate on the board, so that I can see the better sequence even when (especially when) I got it wrong.
9. ~~As a player, I want to see how my result compares to the optimal on simple board metrics (holes, bumpiness, height), so that I understand *what* my placement cost me.~~ **Superseded:** feedback is now a [letter grade](glossary.md#letter-grade) + [ranked combo list](glossary.md#ranked-combo-list).
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

30. ~~As the system, I want to select puzzles randomly/sequentially from the bank in v1.~~ **Superseded:** [matchmaking](glossary.md#matchmaking) serves puzzles within a rating band.
31. ~~As the system, I want to grade an attempt by exact-matching the player's final resting placements (column + rotation) against the stored optimal line on both plies.~~ **Superseded:** [combo-threshold grading](glossary.md#combo-threshold-grading) matches by resulting board.
32. ~~As the system, I want to start every puzzle at a flat seed rating.~~ **Superseded:** puzzles are [difficulty](glossary.md#difficulty)-seeded.
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

> **Superseded (narrowed):** since the 2026-06-21 v2 overhaul, Hz-invariance checks **left/right traverse speed only**. Tuck/spin *capability* is granted (assumed always executable) and is not gated. See [glossary: Hz-invariance](glossary.md#hz-invariance) and [decisions.md](decisions.md) (v2 overhaul).

- Only puzzles whose optimal answer is **identical across the full range of piece-movement speeds** are shipped. Concretely, the generator evaluates the optimal move at a **slow-tap** timeline and a **fast-DAS** timeline and keeps the candidate only if the returned placement is the same.
- Effect: no puzzle's answer ever depends on execution speed; the trainer measures stacking judgment only. This also removes reachability from the input problem — the player selects a resting placement, and grading compares resting placements.

### Generation pipeline

1. **Source candidate boards** via simulated **semi-random self-play**: the engine plays from empty using a mostly-optimal policy with occasionally injected suboptimal/random legal moves, accumulating realistic imperfections; snapshot at a random mid-game point.
2. For each candidate, query the engine to build the **optimal two-ply line** and the **second-best** alternatives needed for the quality gate.
3. ~~**Unambiguity (fairness) gate:** keep a candidate only if the best line beats the second-best by a large `totalValue` margin, applied to **both plies**.~~ **Superseded:** [dropped](glossary.md#unambiguity-gate-fairness-gate) for combo grading (2026-06-20). Quality now rests on board-health + combo-threshold.
4. **Hz-invariance gate:** keep only candidates whose optimal combo is identical at slow-tap and fast-DAS (narrowed to left/right speed only since 2026-06-21).
5. **Persist** the surviving puzzle: board, piece1, piece2, optimal two-ply line, [combo table](glossary.md#combo-table) (top-K combos with scores), [type-tags](glossary.md#puzzle-type-tag), and a [difficulty](glossary.md#difficulty)-seeded rating. Additional gates since v1: [board-health floor](glossary.md#board-health-floor), [rank-1 outcome-quality](decisions.md) (#50), [BetaTetris consensus](decisions.md) (#55), [deduplication](glossary.md#deduplication).
- The **board source is an abstraction**; self-play is the only implementation in v1, with real-gameplay extraction anticipated as a later implementation behind the same interface.

### Checker (v1)

> **Superseded** by [combo-threshold grading](glossary.md#combo-threshold-grading) (2026-06-20). Both pieces are always placed; grading is by resulting-board outcome matching against the combo table; Correct = A+ (score ≥ 97). See [decisions.md](decisions.md) (combo-grading overhaul).

- ~~**Exact-match, solve-the-whole-line.** The player must match the optimal **first** placement *and* the optimal **second** placement; matching means same final resting **column + rotation**.~~
- ~~A wrong first placement **fails the puzzle immediately** and reveals the correct line (the second move is not separately graded, since the optimal second move assumed the optimal first move).~~
- ~~This is explicitly a prototype checker. Tolerance-based grading ("within X% of optimal `totalValue`") and adaptive per-move judging are deferred.~~

### Rating

> **Superseded (seeded + matchmaking):** puzzles are now [difficulty](glossary.md#difficulty)-seeded (not flat), and [matchmaking](glossary.md#matchmaking) serves puzzles within a rating band. See [decisions.md](decisions.md) (v2 overhaul, 2026-06-21).

- **Glicko-2 co-rating.** Players and puzzles both carry a rating, deviation, and volatility.
- ~~**Flat seed:** every puzzle starts at the same rating; difficulty is *not* derived from engine signals in v1.~~ Puzzle ratings are now seeded from generated [difficulty](glossary.md#difficulty) and drift toward true difficulty as attempts accumulate.
- ~~**Consequence baked into v1:** puzzle selection is random/sequential.~~ [Matchmaking](glossary.md#matchmaking) draws from a rating band around the player, with an [anti-repeat cooldown](glossary.md#anti-repeat-cooldown).
- **No anti-cheat** in v1 (accepted: niche audience, low incentive). Grading and rating computation run client-side and write straight to Supabase.

### Feedback after an attempt

> **Superseded:** feedback is now a [letter grade](glossary.md#letter-grade) banner + [ranked combo list](glossary.md#ranked-combo-list) + NES chiptune. See [decisions.md](decisions.md) (grill-with-docs #5).

- Show the [letter grade](glossary.md#letter-grade) (A+ = win, green; below = red) + one-decimal score, with a distinct NES chiptune.
- **Animate** the stored optimal two-ply line on the board (now [tuck/spin-aware](glossary.md#tuck--spin) and [color-aware](glossary.md#color-grid)).
- Show a [ranked combo list](glossary.md#ranked-combo-list) (top-5 with scores; player's combo highlighted).
- ~~Show **geometric metric deltas** — holes, bumpiness, height.~~ Replaced by the combo list and letter grades.
- Natural-language "why" explanations remain deferred.

### Auth (default, confirmable)

- Supabase Auth with **email** plus **OAuth (Google and Discord)**.

### Data model (sketch)

> **Expanded since v1.** See `packages/data/schema.sql` for the current schema.

- **puzzles:** board, piece1, piece2, optimal line, [combo table](glossary.md#combo-table) (top-K), [type-tags](glossary.md#puzzle-type-tag), [difficulty](glossary.md#difficulty) columns (accept_count, margin), color grid, active flag, rating + deviation + volatility.
- **user_ratings:** user, rating + deviation + volatility.
- **attempts:** user, puzzle, the line the player played, solved/not, score, ratingAfter, timestamp.
- **puzzle_star_ratings:** user, puzzle, 1–5 star rating.
- **puzzle_flags:** admin flag/cull log.
- **admin_emails:** verified-email allowlist.
- **submissions:** screenshot submission queue.

### Deep modules (the custom surface to build carefully)

- **Engine client** — wraps the local engine's HTTP endpoints and the 200-char board encoding behind a typed "give me the best move / score this move" interface; offline only; hides encoding and the confirmed board orientation.
- **Board model & metrics** — pure functions over a board grid: encode/decode, apply a placement, and compute holes / bumpiness / column heights. Used both offline (store optimal metrics) and in the client (player-move metrics). No engine dependency.
- **Self-play generator** — turns a noisy self-play policy into candidate boards via mid-game snapshots, behind a pluggable board-source interface.
- **Quality filters** — pure predicates over engine outputs: Hz-invariance, board-health, rank-1 outcome-quality, BetaTetris consensus, deduplication. (The v1 unambiguity gate was [dropped](glossary.md#unambiguity-gate-fairness-gate).)
- **Checker** — [combo-threshold grading](glossary.md#combo-threshold-grading): outcome-by-resulting-board matching against the combo table, score ≥ 97 = correct. (Replaces the v1 exact-match checker.)
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

> Several items below have since shipped. Items marked ✅ are now in scope.

- ✅ ~~**Tolerance-based / graded scoring**~~ — shipped as [combo-threshold grading](glossary.md#combo-threshold-grading) with [letter grades](glossary.md#letter-grade) (2026-06-20).
- **Live engine at play time** — still out of scope; grading uses the stored combo table.
- **Real-gameplay-derived boards** — still out of scope (self-play only), though [screenshot submission](glossary.md#screenshot-submission) is the first step.
- ✅ ~~**Rating-matched puzzle selection / matchmaking**~~ — shipped as [matchmaking](glossary.md#matchmaking) with difficulty-seeded ratings (2026-06-21).
- ✅ ~~**Difficulty display**~~ — shipped as 4 [difficulty bands](glossary.md#difficulty) (very-easy/easy/medium/hard) with a tetris cap (2026-06-22).
- **Natural-language explanations** of why the optimal line is better — still deferred.
- ✅ ~~**Tuck/spin-required puzzles**~~ — shipped: tucks and spins are [first-class](glossary.md#tuck--spin) (2026-06-21); tuck/spin puzzles are in the bank; [type-tags](glossary.md#puzzle-type-tag) label them.
- **Anti-cheat / server-side trust boundary** — explicitly accepted as out of scope.
- **Product shell** — daily puzzles, streaks, shareable results, leaderboards, social features — still deferred.
- **Engine deployment** — the engine stays an offline generation tool.

---

## Further Notes

- **Build order suggestion:** (1) engine client + board model with the board-orientation check; (2) self-play generator + the two quality filters, producing a small bank; (3) play app — board render, ghost input, checker, feedback — reading that bank from Supabase; (4) rating glue + auth + persistence; (5) scale the bank to a few hundred puzzles.
- **The real risk v1 must retire** is *puzzle quality*: do self-play snapshots that survive the filters feel like good, instructive puzzles to a human? Generate a small batch and play them before scaling.
- **Board-orientation caveat:** confirm the engine's `parseBoard` row orientation before trusting any generated bank — a flipped board silently corrupts every puzzle.
- ~~**Co-rating cold start:** with flat seeds…~~ Puzzle ratings are now [difficulty-seeded](glossary.md#difficulty), so [matchmaking](glossary.md#matchmaking) is meaningful from launch.
- ~~**Fairness coupling:** the unambiguity gate and the exact-match checker are coupled.~~ Both were replaced: the gate was [dropped](glossary.md#unambiguity-gate-fairness-gate), the checker became [combo-threshold grading](glossary.md#combo-threshold-grading).
