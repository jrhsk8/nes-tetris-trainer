# Decisions

Lightweight log of decisions not captured in [PRD-v1.md](PRD-v1.md) (the PRD owns product/architecture decisions; this owns tooling, repo, and doc choices). Newest first.

### 2026-06-20 — Combo-grading overhaul (grilling session #2)

A second `/grill-with-docs` session reworked grading, feedback, and board generation. These decisions **supersede parts of the earlier same-day UX-overhaul entry** — specifically the "no cross-product needed" premise, the exact-match checker, the strip-plot solutions chart, and the `first_values`/`second_values` model — and require **another full bank regeneration**.

- **Grading → two-piece combo model.** A puzzle becomes "find the best two-piece combo." The player **always places both pieces** (the wrong-first-move short-circuit in `checker.ts`/`PuzzleSession.tsx` is removed). An attempt is the combo `(placement₁, placement₂)`, scored by StackRabbit's evaluation of the board after both placements, field-normalized 0–100 across the puzzle's combos. **Correct = score ≥ 95** (within 5% of the best). The binary solved/failed signal for co-rating follows that bar (a near-miss and a catastrophic miss both count as failed — Glicko-2 stays binary).
- **No cross-product → cross-product, top-K stored.** This reverses the first overhaul's "a wrong first move ends the puzzle, so no cross-product is needed." Generation now sweeps the full cross-product (~400–1000 combos/puzzle) to rank and normalize, but **stores only the top-K (K ≈ 30, tunable)** ranked combos (placements + 0–100 score + total ranked count). Rows stay tiny; no live engine at play time. Player buckets: top-5 → highlighted in the list; ranks 6–K → shown with exact rank+score; beyond K → "too low to rank" (this is R5's "too bad to evaluate" case).
- **Gates.** The discrimination/unambiguity gate is **dropped** — combo-threshold grading needs no unique best. **Hz-invariance is kept**, retargeted from "optimal move per ply" to "the best combo is identical across slow-tap/fast-DAS." Puzzle quality now rests on board quality + the ≥95 bar (accepted risk: an occasional trivially-passable puzzle).
- **Board quality (R3) — StackRabbit board-health floor.** Keep a snapshot only if its **minimum best-move value across all 7 piece types** clears a moderate, tunable floor — a piece-independent proxy for "a board StackRabbit rates highly," since StackRabbit exposes no static board evaluation. A cheap geometric pre-filter (holes/bumpiness) drops obvious garbage first; the floor runs as an early gate before the combo sweep. Chosen over pure geometric thresholds because the owner wanted a StackRabbit-grounded measure; min-over-7 (not the actual current piece) keeps it about the board, not the piece draw; "don't overdo it" → keep the floor moderate to protect yield. Self-play noise may be lowered to feed cleaner candidates.
- **Feedback (R4/R5).** The strip-plot solutions chart is replaced by a **verdict banner** (Correct/Incorrect + 0–100 score) and a **ranked combo list**: top-5 with scores, the player's combo highlighted if among them, otherwise a row below showing rank+score (6–K) or "too low to rank" (beyond K). Rows are **interactive** — selecting one animates that combo on the central board (the existing replay parameterized by `(p1, p2)`); the player's move is selected by default.
- **Colors (R1).** The feedback/replay path never passed `colorGrid` to the board ([Feedback.tsx](../apps/play/src/feedback/Feedback.tsx), [replay.ts](../apps/play/src/feedback/replay.ts)), so the stack reverted to white after placement. Fix: make the replay **color-aware** (base = the puzzle's color grid; each dropped piece paints its NES color group) and pass `colorGrid` to the feedback board. The original stack never goes white; every animated piece (player's or engine's) carries its group color.
- **Layout (R6).** The board shipped at `min(40vh, …)` (not the ~80vh the first overhaul intended) under two stacked headers with `align-items: start`, forcing scroll. Fix: a **slim combined top bar** (small wordmark + Play/History/Controls nav, subtitle dropped), board grown to ~`min(72vh, …)` and the play area vertically centered, so it holds on one screen on desktop/tablet (phones still stack/scroll).
- **Accepted costs.** Another full bank regen → new puzzle IDs, the live bank replaced again, post-#27 attempts orphaned (same pattern accepted on the first overhaul). Schema: replace `first_values`/`second_values` with a `combos` column (top-K). `checker.ts` rewritten (no short-circuit; combo lookup + threshold).

### 2026-06-20 — UX overhaul (grilling session): layout, colors, solutions chart, replay, input, history

A `/grill-with-docs` session reworked the play app's UX. The decisions below supersede the relevant feedback/layout sketches in the PRD and are filed as phased GitHub issues (Phase 1 = client-only; Phase 2 = offline bank regeneration + schema; Phase 3 = client features that consume the new data).

- **Performance — drop the CRT layer.** Scroll/general jank traced to the full-viewport `body::after` overlay: `mix-blend-mode: multiply` plus a 160px-blur inset shadow forces a whole-viewport re-composite on every paint. Removing the overlay and the body grid texture for a flat look was chosen over keeping a cheapened effect. The 200-`div` board is kept as-is (a larger board is the same cell count).
- **Layout — flanking dashboard.** The board is the centered hero, sized to the viewport height (`min(~80vh, …)`) so it stays maximal with no scroll, and it never moves between phases. Supporting UI flanks it: left = rating + on-screen controls; right = the NES next-box while solving, then the solutions chart after an attempt (they never co-occur). One-screen is guaranteed on desktop/tablet only; phones collapse to a stacked, scrollable column. Every panel clips its children (`overflow: hidden` + `max-width: 100%`), which fixes the chart-overflow bug structurally. The optimal line animates on the central board in place.
- **Piece colors — authentic, via full regen.** The existing bank cannot recover per-cell colors (no piece history was stored), so authentic colors require a full bank regeneration with color-tracking self-play — chosen over client-side synthesis. Colors are stored as a *separate* 200-char color grid (`'0'` empty, `'1'/'2'/'3'` = NES color group) so the binary `Grid` and all metrics/checker logic stay untouched. Accepted cost: new puzzle IDs, the live bank replaced, existing attempts orphaned.
- **Next-piece box.** Rendered as a real piece graphic (spawn orientation, NES color) in a bordered box, top-right (NES-accurate). The current piece stays the on-board ghost (no separate display). The box is empty on placement 2 (no lookahead).
- **Replay animation.** The piece spawns at top-center and performs one eased rotate-and-slide during the upper part of the fall, then drops straight to rest; clip-checked so it never passes through the stack; a flash-and-collapse plays when a line clears; honors `prefers-reduced-motion`. Safe because the Hz-invariance gate guarantees every optimal placement is tuck-free.
- **Solutions chart — replaces the geometric-metrics table.** After an attempt, feedback shows two per-piece value distributions instead of the holes/bumpiness/height table. Because a wrong first move ends the puzzle, only two flat lists are needed (no placement1 × placement2 cross-product): piece-1 over all its legal placements, and piece-2 over all its legal placements on the board *after the optimal first move*. Both are precomputed at generation (`first_values` / `second_values`) — no live engine, sidestepping the deferred totalValue-% feature. Each is drawn as a strip plot (dots = alternatives, ★ = optimal, ● = the player's move) with a rank callout ("5th of 17"); positions are field-normalized 0–100 and rank is the headline number. The `boardMetrics` functions remain (the generator still uses them); only the player-facing table is removed.
- **Input — rebindable keys.** Defaults: ←/→ move, `z` = rotate CCW, `x` = rotate CW (this adds counter-clockwise rotation, which did not exist), Enter/Space confirm, ↑ = rotate-CW alias. Five actions are rebindable via a Controls panel (press-to-bind; conflicts warn rather than silently double-bind). Bindings persist in a new Supabase user-prefs table so they sync across devices, like the rating.
- **History view.** A header nav (Play / History / Controls) opens a sortable/filterable list of past attempts (date / difficulty / result), newest-first, paginated. Difficulty is read by joining attempts → puzzles. Each row re-opens the puzzle read-only in the Feedback view; only post-regen attempts are re-openable (older puzzle IDs are gone).
- **Repo layout correction.** The implementation landed as npm workspaces — `apps/play` + `packages/{core,data,rating}` + `generator/` — not the `src/` split recorded on 2026-06-19. CLAUDE.md's layout section was updated to match.

### 2026-06-19 — Glossary terminology revision

Reviewed [glossary.md](glossary.md) term by term. Key changes: renamed the puzzle unit to **"piece / next-piece puzzle"** and dropped **"two-ply line"** as redundant jargon (the solution is just **Optimal line**); renamed **Ghost → Ghost placement** to avoid colliding with Tetris's standard hard-drop drop-shadow; generalized **Hz-invariance** to "movement/reaction agnostic" across the full speed range; broadened **Stacking** to include line-clear strategy. **Removed "Flat seed"** (the seeding mechanism is expected to change, so it's not documented) and **"totalValue"** (engine-internal; mentioned inline only). CLAUDE.md's orientation line updated to match the puzzle rename.

### 2026-06-19 — CLAUDE.md scope: hybrid

CLAUDE.md is a thin operating layer (commands, guardrails, conventions, reporting style) plus a short orientation summary, and defers to the PRD for all deep spec/architecture detail. Avoids both per-invocation PRD reads and duplication that rots.

### 2026-06-19 — Repo layout: single repo, `src/` split

`src/core` (pure, shared), `src/app` (React SPA), `src/generator` (offline Node). Chosen over npm workspaces to keep a prototype light (one install, one tsconfig). The decoupling of the two halves is enforced by convention, not package boundaries.

### 2026-06-19 — Toolchain: Vitest + TypeScript, npm; no linter/formatter pinned

Test runner Vitest, typecheck via `tsc --noEmit`, package manager npm. Deliberately did **not** pin a linter or formatter — keep the prototype light; add one later if friction appears.

### 2026-06-19 — Guardrails in CLAUDE.md: lean (two only)

CLAUDE.md encodes only two hard "never" rules: engine-offline-only, and off-the-shelf-except-the-puzzle-core. Other PRD constraints (Hz-invariance gate, no-Vercel/no-Next) remain in the PRD but are not repeated as CLAUDE.md guardrails.

### 2026-06-19 — Reporting style scope: conversational only

The concision rule ("be extremely concise and sacrifice grammar") applies to chat/status reports to the owner only. Artifacts (commit messages, PR bodies, code comments, docs) stay clear and grammatical.

### 2026-06-19 — Domain glossary added

Created [glossary.md](glossary.md) for the term-dense domain; CLAUDE.md links to it so every agent shares the vocabulary.
