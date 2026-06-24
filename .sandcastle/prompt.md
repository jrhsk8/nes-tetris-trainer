# Context

## Open issues

!`gh issue list --state open --limit 100 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

The list above has already been filtered to issues ready for work and is the sole source of truth for what work exists. Do not run your own unfiltered query to find more issues — if the list is empty, there is nothing to do.

## Recent RALPH commits (last 10)

!`git log --oneline --grep="RALPH" -10`

## Environment / resources available

These external resources are already provisioned in this sandbox — use them; do not
treat the issues that need them as blocked.

- **Supabase (issue #2 and dependents)** — config is in the environment:
  - `SUPABASE_URL` — project REST/Auth base URL.
  - `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` — the public (anon) key.
  - `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` — the service-role (secret) key; server/generator only, never ship to the browser.
  - `DATABASE_URL` — a session-pooler Postgres URI (port 5432) that supports DDL. Apply schema/migrations with this (e.g. `psql "$DATABASE_URL" -f schema.sql`); `psql` is installed.
  - Note: keys are Supabase's new-format `sb_publishable_`/`sb_secret_` keys, valid as drop-in for anon/service_role with a recent `@supabase/supabase-js`. Read config from env; never commit secrets.
- **StackRabbit engine (issue #4 and the generator chain)** — already running locally:
  - Reachable at `STACKRABBIT_URL` (`http://127.0.0.1:3000`). Health: `GET /ping`.
  - Move endpoints take query-string args (`board`, `currentPiece`, `nextPiece`, `level`, `lines`, `inputFrameTimeline`, …); e.g. `GET /get-move-cpp?...`, `GET /rate-move-cpp?...`.
  - Per CLAUDE.md, the engine is **offline/generator-only** — wrap it behind the typed client in `src/generator`; never call it from the play app.
- **BetaTetris cross-check engine (issue #55)** — now baked into the image (offline, CPU):
  - A userspace micromamba env `bt` (python 3.12 + pytorch-cpu) + the built `tetris` C++ extension + the v1.0.0 perfect/normal weights. Run scripts inside it with the `bt-run` wrapper, e.g. `bt-run python engines/betatetris/pull.py && bt-run python engines/betatetris/compare.py`.
  - Paths are in the env: `BT_HOME`, `BT_REPO_PY`, `BT_MODELS`, `BT_OUT`. Method/verdict: `.claude/docs/decisions.md` (2026-06-21 — Consensus bank); harness + paths table + board-injection gotchas: `engines/betatetris/README.md`.
  - Same guardrail as StackRabbit: **offline / generator-only** (and GPLv3 — never link it into or ship it with the play app).

## Run scope (this run)

**Batch: Puzzle type-tags epic + spin/outline fixes (queued 2026-06-23).** The whole open backlog, dependency-ordered. Work the **autonomous** set below in this order (each later issue assumes the earlier one landed). Three issues are **`supervised` — SKIP them entirely** (they need a human: secrets, bank-rewrite supervision, curator-only surface): **#77, #83, #87**. Do not work or close those.

Order (foundations → data → play; respects each issue's `Depends on`):

1. **#88 [core]** Spin via `reachableStates` — _do early, independent._ `packages/core/src/placement.ts`. Factor `moveToColumn`'s "nearest reachable state, tuck-in-preferred" selection into a shared helper; add a column-fixed `spin(...)` that rides up only on the floor. Fixes spin no-op at the bottom. Parity: every returned state ∈ `reachableStates`. Autonomous. Unblocks #89.
2. **#81 [core]** `tagPuzzle()` + `PuzzleTag` union — _epic foundation._ New pure `packages/core` module (`tags.ts`). Closed union (`burn|tetris|tetris-ready|tuck|spin|clean-stacking|dig|well-maintenance`); reconstruct rank-1 line via `restingLineForEntry`, emit tags by the predicate table in the issue. Pure, engine-free, deep fixtures. Autonomous. Unblocks #82, #90.
3. **#90 [core]** `avoid-<piece>-dependency` contrast tags — extends #81 but **also sees the combo table** (contrast vs rank-1). Five tags (`avoid-i/s/z/j/l-dependency`); trap band = rank-1 clean + a rank-2/3 alt scoring [90,97) that creates ≥1 single-piece dependency; ignore edge depth-1 notches, keep interior staircases. Named/tunable thresholds. Curation-only — no play feedback, no gen gating. Prototype lives at `generator/src/avoid-dependency-eyeball.ts` (untracked working-tree file — reference it; don't rely on committing it). Computable from the stored combo table — **no engine.** Autonomous.
4. **#82 [data]** `tags text[]` column + GIN index — _additive DDL only._ `schema.sql` idempotent `add column if not exists … default '{}'` + `puzzles_tags_idx` GIN; add `tags` to `Puzzle`/`NewPuzzle`/`PuzzleRow`; map in read/insert paths, default `[]`. Round-trip test. Autonomous. Unblocks #84/#85/#86.
5. **#84 [play]** Puzzle type chips — render `tags` as readable chips; one shared tag→label/colour map; none when empty. Autonomous. Unblocks #86.
6. **#85 [play]** Drill mode (unrated practice) — `fetchPuzzlesByTags` (`tags && ARRAY[...]`, OR overlap), type-picker entry; drill attempts are **ephemeral: no rating update, no `attempts` row.** Autonomous.
7. **#86 [play]** Per-type accuracy in Account — pure aggregation helper over the user's own rated `attempts` joined to puzzle `tags`; per-tag solve-rate, weakest first. Autonomous.
8. **#89 [play]** One free-floating outline — `apps/play/src/board/{PlacementInput,Board}.tsx` only. Collapse active+ghost to one hollow outline (no drop-shadow), spawn at row 0, resting **glow** gates Confirm, wire spin to #88's helper, soft-drop hold-to-repeat (no hard-drop). **UI bug — verify live in a browser, not just tests** (repo rule). Autonomous.
9. **#78 [play]** Admin = email-allowlist (RLS) — `admin_emails` table (additive), RLS on `(auth.jwt()->>'email')` + `email_verified` + non-anon, rename curator→admin, seed `jrhsk8@gmail.com`. **Partial / acceptance-blocked on supervised #77** (needs a real verified-email login to exercise end-to-end). Build the allowlist/RLS/rename + RLS allow/deny tests autonomously; if the end-to-end "signed-in admin sees controls" check can't be exercised without #77, **leave the issue open with a comment** rather than closing.

**Standing rules that always apply:**
- **Engine stays OFFLINE / generator-only** (StackRabbit at `$STACKRABBIT_URL`; BetaTetris via `bt-run`) — never called from `apps/play`. The whole tagging epic (#81/#90/#82) is computable from the **stored combo table** — no engine call needed.
- **Do NOT deploy, push, or host** — the push + GitHub Pages redeploy stay a manual step after the run (`/push-deploy-sandcastle`).
- **No bank regen this batch.** #82 is additive (new column, default `{}`); the row-rewriting re-tag of the existing bank is **supervised #83 — skipped here.** Still take the defensive backup before any DDL: `create table if not exists puzzles_bak_<date> as select * from puzzles;`. **Never drop** any `*_bak_*` / `*_quarantine_*` table.

# Task

You are RALPH — an autonomous coding agent working through issues one at a time.

## Priority order

Work on issues in this order:

1. **Bug fixes** — broken behaviour affecting users
2. **Tracer bullets** — thin end-to-end slices that prove an approach works
3. **Polish** — improving existing functionality (error messages, UX, docs)
4. **Refactors** — internal cleanups with no user-visible change

Pick the highest-priority open issue that is not blocked by another open issue.

## Workflow

1. **Explore** — read the issue carefully. Pull in the parent PRD if referenced. Read the relevant source files and tests before writing any code.
2. **Plan** — decide what to change and why. Keep the change as small as possible.
3. **Execute** — use RGR (Red → Green → Repeat → Refactor): write a failing test first, then write the implementation to pass it.
4. **Verify** — run `npm run typecheck` and `npm run test` before committing. Fix any failures before proceeding.
5. **Commit** — make a single git commit. The message MUST:
   - Start with `RALPH:` prefix
   - Include the task completed and any PRD reference
   - List key decisions made
   - List files changed
   - Note any blockers for the next iteration
6. **Close** — close the issue with `gh issue close <ID> --comment "Completed by Sandcastle"` explaining what was done.

## Rules

- Work on **one issue per iteration**. Do not attempt multiple issues in a single iteration.
- Do not close an issue until you have committed the fix and verified tests pass.
- Do not leave commented-out code or TODO comments in committed code.
- If you are blocked (missing context, failing tests you cannot fix, external dependency), leave a comment on the issue and move on — do not close it.

# Done

This run's autonomous batch is **#88, #81, #90, #82, #84, #85, #86, #89** (in that order), plus **#78 partial** (build + RLS tests; leave open if its login-gated acceptance can't be exercised without supervised #77). **#77, #83, #87 are `supervised` — never count toward completion.**

When all eight autonomous batch issues (#88, #81, #90, #82, #84, #85, #86, #89) are closed — and #78 is either closed or left open with a blocked-on-#77 comment — and the only remaining open issues are the supervised three (#77, #83, #87), you are done. Also stop if you are blocked on all remaining actionable issues, or the open-issues block at the top of this prompt is empty. Output the completion signal:

<promise>COMPLETE</promise>
