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

A board the generator prefers because it resembles a position a strong player would actually reach: few or no [holes](#combo-score), low bumpiness, and moderate height. Since grill-with-docs #5 the generator's default accept is **strict-clean** (target holes ≤ 1, bumpiness ≤ ~12, max height ≤ ~12), with a smaller **variety lane** (~20% of the bank: holes ≤ 2, bumpiness ≤ ~20) so some texture survives. Cleaner boards are the better teaching material, so a lower candidate yield is an accepted cost. Distinct from the older fairness/health and rank-1 outcome-quality gates, which reject *unplayable* or *degenerate* boards rather than merely *messy* ones.

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

A per-puzzle generation property (since 2026-06-21), computed from two combo-distribution signals and stored raw: **`acceptCount`** — the number of combos scoring ≥ 95 (the [combo-threshold](#combo-threshold-grading) bar; few acceptable answers = hard) — and **`margin`** — the score gap between the best combo and the best one *below* 95 (a large gap means the answer stands alone, hard to hit by luck). Combined into the puzzle's **seed rating** (harder → higher seed), which bootstraps [matchmaking](#matchmaking) immediately rather than waiting for crowd data. The bank is biased toward hard with an easy tail kept for new/low-rated players; per the player's own definition, an *easy* puzzle is one with "many acceptable highly-rated moves." **Bands (since grill-with-docs #6, 2026-06-22): `very-easy` / `easy` / `medium` / `hard`**, bucketed by `acceptCount` — `very-easy` is the most forgiving (highest `acceptCount`), seeded below the old `EASY_SEED`. A puzzle where **any acceptable combo (score ≥ 97) clears a tetris** (a single 4-row clear by one of its two placements) is **capped at `easy`** — never `medium`/`hard`, with `acceptCount` choosing `easy` vs `very-easy` under the cap and the seed rating capped to match — because cashing a recognizable tetris is trivial regardless of how tight the answer set is. The tetris cap is detectable offline from the stored [combo table](#combo-table) (replay the placements, count cleared rows), so it is a cheap re-band, not a fresh sweep.

### Deduplication

A generation gate (since 2026-06-21): reject a candidate whose **`(piece1, piece2)` match and whose board is within a small Hamming distance** of any puzzle already accepted — checked against both the in-progress batch and the existing [bank](#the-bank). Catches *near-identical* look-alikes (different IDs, same-looking board), not just byte-identical duplicates. Complements the play-side [anti-repeat cooldown](#anti-repeat-cooldown): dedup keeps look-alikes out of the bank; the cooldown keeps the same puzzle from recurring too soon.

### Unambiguity gate (fairness gate)

v1 generation filter, **dropped** for combo grading on 2026-06-20. It kept a candidate only if the best line beat the second-best by a large margin on both placements, to make exact-match grading fair. [Combo-threshold grading](#combo-threshold-grading) needs no unique best, so the gate was removed; board quality is now ensured by the [board-health floor](#board-health-floor) and meaningfulness by the ≥95 bar (accepted risk: an occasional trivially-passable puzzle).

### Hz-invariance

A generation filter: keep a candidate only if its **best combo** is identical across the full range of **left/right movement speeds** (slowest tap to fastest DAS). "Execution speed" here means **horizontal traverse speed only** — how far a piece can be moved left/right before it locks. [Tuck and spin](#tuck--spin) *capability* is **granted** (assumed always executable) and is explicitly **not** gated, so a tuck/spin can be the optimal answer. The puzzle is agnostic to horizontal movement speed — never to stacking judgment or tuck/spin skill. (2026-06-21: narrowed from "all piece-movement speeds" to left/right only, reinstating tucks as legal answers. 2026-06-20: retargeted from "optimal move per ply" to "best combo.")

### Slow-tap / fast-DAS

The two extremes of **left/right** piece-movement speed: slowest manual tapping vs. fastest DAS (Delayed Auto Shift — the auto-repeat when a direction is held). The endpoints checked for [Hz-invariance](#hz-invariance). They bound horizontal traverse only; tuck/spin reachability is assumed (see [tuck / spin](#tuck--spin)).

### Tuck / spin

A resting placement reached by sliding a piece **under an overhang** (tuck) or **rotating it into a pocket** (spin) — one a straight hard-drop can't reach, so it rests *lower* than the drop column would allow. As of 2026-06-21 these are **first-class**: the generator enumerates them as combo candidates, StackRabbit values them, a tuck/spin can be the [optimal line](#optimal-line), and the [ghost](#ghost-placement) can place them. They are pure stacking judgment, not [execution](#hz-invariance) — the trainer grants the maneuver and grades only where the piece rests. *Binding invariant:* the generator's enumerated placement set must be a **superset** of what the play-app input can place, or [outcome matching](#combo-threshold-grading) would wrongly reject a legal tuck.

### Geometric metrics

Board measures: **holes** (empty cells with a filled cell somewhere above), **bumpiness** (sum of height differences between adjacent columns), and **height** (the stack's overall height). Used in the generator's [board-health](#board-health-floor) pre-filter and to precompute optimal-side metrics; the player-side values are computed client-side. Not shown to the player (feedback is the [ranked combo list](#ranked-combo-list)).

### Self-play / board source

Generation sources candidate boards via simulated semi-random self-play (mostly-optimal policy with occasional injected suboptimal moves), snapshotted at a random mid-game point. The board source is a pluggable interface; self-play is the only v1 implementation, with real-gameplay extraction anticipated behind the same interface. (The injected-noise rate may be lowered to feed the [board-health floor](#board-health-floor) cleaner candidates.)

### StackRabbit

The local NES Tetris AI engine that evaluates moves ([github.com/GregoryCannon/StackRabbit](https://github.com/GregoryCannon/StackRabbit)). Used only in the offline generator. Never deployed, never queried at play time. Scores *moves* (placements with lookahead); it has **no static whole-board rating** — hence the piece-averaged [board-health floor](#board-health-floor) proxy.

### Replay

The post-attempt animation on the central board (**not** to be confused with [Review misses](#review-misses), which is *re-attempting* a puzzle you got wrong): a piece spawns at top-center, performs one eased rotate-and-slide during the upper part of the fall, then drops straight to rest (clip-checked, with a flash-and-collapse on a line clear; honors `prefers-reduced-motion`). Now **color-aware** (base = the puzzle's [color grid](#color-grid); each dropped piece paints its NES color group) and **parameterized by combo** — it can animate any combo selected in the [ranked combo list](#ranked-combo-list), not just the optimal line. (2026-06-21: must now animate [tucks/spins](#tuck--spin) — slide under overhangs / rotate into pockets — since a combo's optimal need no longer be a straight drop; the "drop straight to rest" path is no longer a safe assumption.)

### Co-rating

Both players and puzzles carry a Glicko-2 rating (rating + deviation + volatility). Solving a higher-rated puzzle raises yours; failing lowers it. "Solved" = the attempt's [combo score](#combo-score) ≥ 95. Puzzle ratings are **seeded from generated [difficulty](#difficulty)** (not flat) and drift toward true difficulty as attempts accumulate. Player ratings persist **live, client-side**, under an [anonymous session](#anonymous-session) (so RLS no longer silently drops the write); puzzle ratings are recomputed **offline in batches** from the attempts log, not written live.

### Community-correct percentage

A per-puzzle difficulty signal shown in the [verdict](#verdict)/results (since grill-with-docs #7): **solved ÷ total attempts**, computed **live** at results time (a count over [attempts](#co-rating); the player's own just-finished attempt is included) and shown **always with its sample size — `X% (N)`** so a tiny sample is self-evident. Displayed alongside the puzzle's numeric [co-rating](#co-rating). An empirical complement to the model-based rating; deliberately *not* the [star rating](#star-rating), which is about fun, not difficulty.

### Star rating

A player's **1–5 star "how fun is this puzzle"** judgement, entered in the results section (since grill-with-docs #7). **Quality/fun, deliberately not difficulty** (that is the rating + [community-correct percentage](#community-correct-percentage)). One rating per user per puzzle, **anonymous allowed and changeable** (upsert, own-row RLS). The community **average is hidden until the player has rated**, then revealed (`avg ★ (N)`) to avoid anchoring. The crowd substrate for a future auto-"interestingness" [curation](#curation) gate.

### Matchmaking

Puzzle selection (since 2026-06-21, replacing uniform-random): draw the next puzzle at random from puzzles whose rating is within a **band around the player's rating** (auto-widening if too few), **excluding recently-seen** puzzles. One query delivers both "around my level with some variance" and the [anti-repeat cooldown](#anti-repeat-cooldown). Made meaningful by [difficulty](#difficulty)-seeded puzzle ratings — the PRD had deferred matchmaking precisely because flat seeds carried no signal.

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
- **Spin — the rotational twin of the lateral law.** Rotation holds the **column fixed**, changes orientation, and snaps to the reachable state at the new rotation **nearest the current row, preferring at-or-below, riding up only when forced** (the floor case). This fixes "can't spin at the bottom" for **every** piece (T/S/Z/L/J/I) with **no per-piece kick table** — NES has no SRS/wall kicks, so spins work by rotating at a height where the shape fits, and `reachableStates` already enumerates exactly those. (Pre-#8, rotation only applied if the new orientation fit at the *exact* current row, so it silently no-opped on the floor.)
- **Drop — soft-drop only, hold-to-repeat.** Down soft-drops one row and **auto-repeats quickly while held**; Up raises one row (to lift off the floor to spin); **no hard-drop**. With no drop-shadow, dropping is also how the player sees where the piece lands.
- **Touch.** Same positioning via **drag anywhere on the board** (finger column → piece column) with ▲/▼ soft-drop for depth, committed by an explicit **Confirm** button.

The model and input remain **navigation-complete**: every move and spin snaps only to states in the generator's BFS `reachableStates`, and locking only ever happens at a resting position — exactly `enumerateResting` — so the player can never confirm a placement the generator did not enumerate (the superset binding invariant, [tuck / spin](#tuck--spin)), and tucks/spins stay first-class. There is no timer — input is "pick a resting placement," not real-time play. (Not the standard hard-drop drop-shadow that "ghost" usually means in Tetris. 2026-06-23 #8: collapsed to one free-floating outline (resting-glow, spin-anywhere, no drop-shadow). 2026-06-23 #7: lateral narrowed to tuck-seeking. 2026-06-22: lateral changed from collision-gated to free/ride-up. 2026-06-21: was hard-drop / column-only, which couldn't express tucks.)

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

A dev-only "is it fun?" pass over [the bank](#the-bank), done **in situ during normal play** (new for grill-with-docs #6, 2026-06-22) — the human axis on top of the automated correctness / cleanliness / [consensus](#combo-table) gates. An **allowlisted [admin](#admin)** account (the *curator* role — renamed **admin** and gated by a **verified-email** allowlist in RLS since grill-with-docs #7, reachable now that [sign-in / linking](#anonymous-session) exists; still enforced in Supabase RLS *not* the client, since the bank is shared by every player) gets two actions while playing: **flag** — attach a free-text **comment**, appended to an append-only `puzzle_flags` log (action `flag`), so later review can mine *what makes puzzles boring*; and **soft-delete** (cull) — write a `cull` log row (with an optional reason) and set the puzzle's `active` flag false, so [matchmaking](#matchmaking) drops it immediately while the row, [combo table](#combo-table), and [attempts](#co-rating) survive (reversible — a misclick mid-play is recoverable). Curation is **organic**: the bank is grown large, but a curator only ever reaches the puzzles matchmaking serves them, so pruning is best-effort over time, never an exhaustive sweep (no systematic review mode, by choice).
