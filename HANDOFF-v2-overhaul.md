# HANDOFF — v2 overhaul (tucks, difficulty, matchmaking, dedup, submission)

> Companion to `docs/decisions.md` (**2026-06-21 — v2 overhaul** entry) and `docs/glossary.md`.
> This file carries the per-issue specifics the `.sandcastle/prompt.md` run-scope and the GitHub issues reference.
> Prepared from `/grill-with-docs` grilling session #3.

## TL;DR

This run builds the **v2 overhaul** as one batch with a **single full bank regeneration**. It **extends the already-shipped combo-grading model** (#31–#35, live on origin/main) with outcome-by-resulting-board matching, first-class tucks/spins, generation-time difficulty, rating-matched selection with anti-repeat, near-duplicate rejection, working rating persistence, and screenshot puzzle submission.

## ⚠️ Critical reconciliation — read first

- **The combo-grading overhaul (issues #31–#35, epic #36) IS implemented and deployed.** origin/main (`56ef029`) carries all five RALPH commits: `combos jsonb` in the schema, `packages/core/src/combo.ts`, `generator/src/pipeline/combo.ts`, the combo-threshold checker (the v1 `checker.ts` was **deleted**), and `apps/play/src/feedback/ComboList.tsx`. The live site runs this combo model. *(An earlier draft of this handoff claimed the combo work "was never implemented / code is still v1" — that was written against a stale local clone six commits behind origin and is wrong. Corrected 2026-06-21.)*
- **v2 EXTENDS the combo model; it does not rebuild it.** Where an issue below references combo grading, that grading already exists — add the new behaviour (outcome-by-resulting-board matching, tucks/spins, difficulty, dedup, matchmaking, anon-auth, submission) **on top**. Do **not** re-create the combo model or hunt for a v1 `checker.ts` (it's gone). The genuinely-new surfaces are real: placement enumeration + input are still **hard-drop-only** (no tucks), there is **no** dedup / difficulty metric / matchmaking, and player ratings are computed but **never persisted** (the dev-bypass user can't satisfy RLS).
- **Do NOT reopen #31–#35.** They are done. The v2 issues below add only the net-new work.
- The 2026-06-20 combo-overhaul `docs/decisions.md` entry and the combo terms in `docs/glossary.md` describe the **shipped** model. The **2026-06-21** decisions entry and the new glossary terms (tuck/spin, difficulty, dedup, matchmaking, anonymous session, screenshot submission) extend it.

## What v2 decides (recap; full rationale in `docs/decisions.md` 2026-06-21)

| Area | Decision |
|---|---|
| Grading | Combo-threshold: place **both** pieces always, score 0–100 across the combo cross-product, **Correct = ≥ 95**, no first-move short-circuit. |
| Matching | By **resulting board (resting cells)** — outcome, not `(rotation, col)` or input path. Fixes the "identical to #1 but graded wrong" report and makes tucks gradeable. |
| Tucks/spins | **First-class.** Enumerate all collision-reachable resting placements (hard-drop + tuck + spin); StackRabbit values each; a tuck/spin can be the optimal combo. |
| Hz-invariance | **Kept, narrowed** to *left/right traverse speed only*. Tuck/spin capability is granted, not gated. Likely raises yield. |
| Input | **Free-positioning ghost** (collision-aware move/rotate/soft-drop, no timer) so tucks/spins are expressible. |
| Difficulty | Per-puzzle `acceptCount` (# combos ≥ 95) **+** `margin` (gap best vs best-below-95), stored raw, combined into the **seed rating**. |
| Board-health floor | **Relaxed** to a fairness/garbage-only floor (the old high floor biased the bank easy); difficulty shaping does the rest, biased hard with an easy tail. |
| Dedup | Reject a candidate whose `(piece1, piece2)` match **and** board is within a small Hamming distance of any already-accepted puzzle (vs batch + bank). |
| Identity / rating | **Anonymous Supabase auth for every visitor** (fixes RLS-dropped writes → "rating never changes"); player rating persists live client-side; **puzzle ratings tallied offline in batches** from `attempts`. |
| Selection | **Matchmaking**: random within a rating band around the player (auto-widen), excluding **recently-seen** puzzles (cooldown). |
| Submission | **Screenshot-only to start**: browser uploads the image to a queue; the **offline** pipeline OCRs → solves → gates → banks (engine never deployed). |

## Binding invariants (correctness — do not violate)

1. **Engine stays offline.** StackRabbit is used only in `generator/`. The play app never imports the engine client. Submission solving happens offline.
2. **Enumeration ⊇ input.** The generator's enumerated placement set must be a **superset** of every placement free-positioning input can produce, or outcome-matching will wrongly reject a legal tuck as "unknown combo."
3. **`Grid` stays colour-blind.** Metrics, placement, and matching operate on the binary grid; the colour grid is parallel only.

## Open implementation risks (de-risk with the generation integration smoke test before the full regen)

1. **Hz operationalization.** StackRabbit's `inputFrameTimeline` couples horizontal reach *and* tuck reachability in one knob. Isolating "horizontal-reach only" (so tucks stay granted) likely needs a **geometric reachability pass** (BFS over move/rotate/soft-drop) to enumerate candidates, plus an **explicit horizontal-reach check** on the optimal — not a two-timeline diff. Verify against the live engine.
2. **`rate-move` reachability.** `rate-move-cpp` currently reports "player move not found" for placements the timeline can't reach (the value-table builder already skips these). Valuing tuck placements needs a permissive timeline or an alternate valuation path. Confirm against the live engine.
3. **OCR accuracy (submission).** NES boards are a regular grid of known colours, so sampling cell centres + classifying empty/filled(+group) is tractable — but reject on low confidence rather than banking a misread board. Highest-uncertainty piece; sequence it last.

---

## Issue breakdown

Slice the v2 into the issues below (epic + 9). Numbers are assigned at creation (this repo is at #36; the epic will be #37+). Each issue is one RALPH iteration: RGR, `npm run typecheck` + `npm run test` green, single `RALPH:` commit, close with a comment. Labels mirror the package layout (`core` / `generator` / `play` / `infra`) and a `bug` label where it applies. **Execution order and `Blocked by` lines are authoritative.**

### EPIC — [EPIC] 2026-06-21 v2 overhaul (tucks, difficulty, matchmaking, dedup, submission)
Tracking issue. Links the 9 below; references this handoff and `docs/decisions.md` 2026-06-21. Notes the #31–#35 reconciliation. Closes when all 9 are closed.

### A — [P1][core] Placement & board model: collision-aware reachability + resting-cell placements + outcome key
- **Scope:** Extend `packages/core` so a placement can represent any resting position (tuck/spin), not just a hard-drop column. Add: collision-aware reachability (BFS over left/right + rotate + soft-drop from spawn) that enumerates **all** legal resting placements; a richer placement/resting-cells representation; a **canonical resulting-board key** (the set of locked cells after a placement, used for outcome-matching). Keep the binary `Grid` colour-blind.
- **Replaces:** the hard-drop-only `restingCells`/`legalColumns` assumption and `generator/src/pipeline/placement.ts` `toPlacement` (which searches only hard-drop space and returns `null` for tucks — delete it; matching now uses the resulting-board key).
- **Acceptance:** unit + round-trip tests prove (a) every tuck/spin resting placement on a constructed overhang board is enumerated and reachable, (b) two encodings landing the same cells produce the same canonical key, (c) hard-drop placements are unchanged.
- **Blocked by:** none.

### B — [P1][infra] Schema + RLS migration: difficulty cols, combo boardKey, submissions, storage, anonymous auth
- **Already present (from #33):** `combos jsonb` exists on `puzzles` (current shape `{ total, entries: [{ col1, col2, rot1, rot2, score }] }`); `first_values`/`second_values` are legacy-nullable. **Do not re-create `combos`.**
- **Scope:** `psql "$DATABASE_URL"` migration. On `puzzles`: add `accept_count int` and `margin double precision` (difficulty, issue D); extend each `combos.entries` element with a canonical **`boardKey`** (resulting locked cells, for outcome-matching) — populated by the regen in D/E, so the column work here is just the additive difficulty cols. Add a `submissions` table (`id, image_path, submitter uuid, status, reason, parsed jsonb, created_at`). Create a Storage bucket for submission images. RLS: confirm anonymous sessions satisfy the existing `user_ratings`/`attempts` `auth.uid() = user_id` insert policies (they will once anon auth exists), ensure `puzzles` is publicly **readable** and not client-writable, and add `submissions` insert/select policies + storage policies.
- **Prerequisite:** **Anonymous sign-ins must be enabled** on the Supabase project (Auth settings). Enable via the dashboard or the Management API with a Supabase access token; if it can't be toggled, leave a blocker comment. *(The supervisor will attempt this before the run; see the launch notes.)*
- **Acceptance:** migration applies cleanly; data-access types in `packages/data` updated for the new columns; a smoke test reads a puzzle with `combos` + the new difficulty columns.
- **Blocked by:** none (parallel to A).

### C — [P1][play][bug] Anonymous auth + rating persistence (fixes "rating never changes")
- **Scope:** On load, establish a Supabase **anonymous** session if none exists, so `auth.uid()` is real and RLS passes. Verify the player rating upsert + attempt insert actually persist (they silently fail today for the all-zeros dev-bypass user). Make the `finish()` catch in `apps/play/.../PuzzleSession.tsx` stop masking a real persistence failure (surface/log it; keep the loop playable). Retire the all-zeros `DEV_BYPASS_USER` path.
- **Acceptance:** an end-to-end test (or scripted check) shows a rating row written and read back across reloads under an anonymous session.
- **Blocked by:** B.

### D — [P2][generator] Tuck-aware combo sweep + narrowed Hz + relaxed floor + difficulty + dedup
- **Scope:** Rewire the generator on top of A. Enumerate candidate placements via reachability (A), build the full **combo cross-product**, value each via StackRabbit, field-normalize 0–100, store **top-K (K ≈ 30)** with placements + score + `boardKey`. **Narrow Hz-invariance** to horizontal-reach only (tucks granted — see risk #1). **Drop** the unambiguity gate. **Relax** the board-health floor to fairness/garbage-only. Compute **difficulty** (`acceptCount` + `margin`) and map to a **seed rating**. Add the **dedup** gate ((p1,p2) + board Hamming, vs batch + bank).
- **Acceptance:** pipeline tests assert combos are ranked/normalized with `boardKey`s, a tuck-optimal constructed board yields a tuck combo at rank 1, difficulty + seed rating are populated, and a near-duplicate candidate is rejected. Engine-touching parts run as the integration smoke test against the live StackRabbit (`$STACKRABBIT_URL`).
- **Blocked by:** A, B.

### E — [P2][generator] Full v2 bank regeneration + offline puzzle-rating tally command
- **Scope:** Back up the current bank, run the v2 pipeline (D) to produce the new bank, and **replace** it. Add an offline operator command that **recomputes puzzle ratings in batches** from the `attempts` table (proper Glicko-2 rating periods). New puzzle IDs; post-regen attempts orphaned (accepted).
- **Acceptance:** the live bank is the v2 bank (combos + difficulty + seed ratings present); the tally command runs against `attempts` and updates puzzle ratings.
- **Blocked by:** D.

### F — [P3][core/play] Switch combo matching to resulting-board key + tuck-aware grading
- **Already present (from #34/#35):** the combo-threshold checker (both pieces always placed, **Correct = ≥ 95**, no short-circuit, "too low to rank" beyond top-K), the verdict banner, and the interactive ranked **`ComboList.tsx`** all exist and are live. **Do not rewrite them.**
- **Scope:** Change how an attempt is matched to a stored combo: today it matches by placement tuple `(rotation, col)`; switch to the **canonical resulting-board key** (locked cells after both pieces) from A, so app-vs-engine rotation-numbering mismatches can't mis-grade a same-cells answer and **tuck/spin** combos are gradeable by where they rest. Wire the key produced by the regen (D/E) through `combos.entries[].boardKey` into the checker. Enhance the combo list/replay only as needed to surface tuck combos (replay tuck animation is issue G).
- **Acceptance:** checker tests prove outcome-match by **cells** (two encodings landing the same cells grade identically), a tuck combo is matched by its boardKey, the ≥95 boundary + both-pieces + too-low-to-rank behaviours still hold; play-flow test still shows verdict + list.
- **Blocked by:** A, B, E (real boardKey data from the regen).

### G — [P3][play] Free-positioning ghost input + tuck-aware replay
- **Scope:** Replace the hard-drop/column-only ghost with **free positioning** (collision-aware left/right, rotate, soft-drop; no timer) so tucks/spins are expressible. Update the **replay** to animate tucks (slide under overhangs / rotate into pockets) rather than always dropping straight.
- **Acceptance:** input test reaches a tuck resting placement on an overhang board and confirms it; replay test animates a tuck combo without clipping through the stack.
- **Blocked by:** A.

### H — [P3][play] Matchmaking selection: rating band + variance + recently-seen cooldown
- **Scope:** Replace uniform-random `getRandomPuzzle` with selection drawn from puzzles within a **rating band around the player** (auto-widen if too few), **excluding recently-seen** puzzles (cooldown window). One query delivers rating-match + anti-repeat.
- **Acceptance:** selection test asserts in-band picks, widening fallback, and that a just-played puzzle is excluded until the cooldown lapses.
- **Blocked by:** B, C (persisted player rating), E (difficulty-seeded puzzle ratings).

### I — [P3][play/generator] Screenshot submission: client upload queue + offline OCR→solve→bank
- **Scope:** Client: a submit affordance that **uploads a screenshot** to Storage + inserts a `submissions` row (status `pending`). Offline: a command that pulls pending submissions, **OCRs the NES grid** into board + pieces (+ level), feeds the pipeline (D), and **banks or rejects** (with reason), updating status. Engine never deployed. Reject on low OCR confidence.
- **Acceptance:** client uploads + enqueues; offline command parses a known screenshot to the correct board/pieces and banks it (or rejects with a reason on a deliberately bad image).
- **Blocked by:** B, D.

## Execution order (authoritative)

`A → B → C → D → E → F → G → H → I`

- A and B have no deps (RALPH may take either first; both P1). C is the bug-fix but blocked by B.
- D/E are the offline generator + regen and block the play features that need real v2 data (F, H) and submission (I).
- G depends only on A and can land any time after A.
- I is last (highest OCR uncertainty).

## Environment / resources (already provisioned — see `.sandcastle/prompt.md`)

- **Supabase:** `DATABASE_URL` (DDL via `psql`), `SUPABASE_SERVICE_ROLE_KEY` (generator/admin writes + enabling anon auth), anon/publishable key for the client. Never ship the service key to the browser.
- **StackRabbit:** `$STACKRABBIT_URL` (`http://127.0.0.1:3000`, health `GET /ping`); generator-only.

## Do NOT

- Do not deploy or host. The GitHub Pages redeploy stays a **manual** step after the run.
- Do not call StackRabbit from the play app.
- Do not reopen #31–#35.
