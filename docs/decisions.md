# Decisions

Lightweight log of decisions not captured in [PRD-v1.md](PRD-v1.md) (the PRD owns product/architecture decisions; this owns tooling, repo, and doc choices). Newest first.

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
