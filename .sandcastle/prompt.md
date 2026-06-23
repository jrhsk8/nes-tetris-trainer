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
  - Paths are in the env: `BT_HOME`, `BT_REPO_PY`, `BT_MODELS`, `BT_OUT`. Method/verdict: `docs/decisions.md` (2026-06-21 — Consensus bank); harness + paths table + board-injection gotchas: `engines/betatetris/README.md`.
  - Same guardrail as StackRabbit: **offline / generator-only** (and GPLv3 — never link it into or ship it with the play app).

## Run scope (this run)

This is the **grill-with-docs #7 batch** (2026-06-23): owner-decided issues **#74-#80**, all settled in a `/grill-with-docs` session and specced in `docs/decisions.md` -> "2026-06-23 ... (grill-with-docs #7)". **Read that decisions entry first** -- every issue body points there for the full spec/rationale. All prior batches (#1-#73) are closed. Work the **dependency order below**, then label priority (bugs first).

**Dependency blocks (respect these):** treat **#75 as blocked until #74 closes** (miss replay builds on #74's attempts-derived selection) and **#78 as blocked until #77 closes** (admin allowlist needs the sign-in identity from #77).

**Known supervised/blocked (do NOT burn restarts on these):** **#77** (anonymous sign-in + Google/Discord OAuth, labeled `supervised`) needs Supabase dashboard config the sandbox CANNOT do — anonymous auth is **disabled** on the project and OAuth providers need the dashboard (no Management PAT in `.env`). Make the autonomous code changes if any are cleanly testable, but **expect to leave #77 open with a comment** describing exactly what the owner must toggle in the dashboard. **#78** (admin allowlist) **depends on #77** — leave it open too if #77 cannot close. These two are the expected blockers; everything else below is fully autonomous and should close.

**Autonomous (these should all close this run):**

- **#74** [play] -- **persistent anti-repeat: 200-window from `attempts` (do FIRST; #75 builds on it).** Replace the session-only 10-id ring (`apps/play/src/session/PuzzlePlay.tsx`, `COOLDOWN_WINDOW`) with the **200 most-recently-attempted DISTINCT** puzzle ids for the user (query `attempts`, `created_at desc`, dedupe, take 200), loaded on session start + appended in memory as you serve. Pass as `recentIds` to `getMatchmadePuzzle`; keep the **band-widen-before-relax** behaviour in `packages/data/src/matchmaking.ts`. No new schema. Autonomous. Tests: window = last 200 distinct; survives reload (same `userId` ⇒ same exclusion); band widens to find unseen before relaxing.
- **#75** [play] -- **miss replay (BLOCKED until #74).** A **miss** = ≥1 attempt and **no** `solved=true` attempt; leaves the set once solved. Add (a) an explicit **Review-misses** mode serving misses **oldest-first**, bypassing the 200-window AND the rating band, and (b) **~1-in-10 auto-injection** in normal play of the oldest **due** miss (one that has fallen out of the 200-window). Autonomous. Tests: miss-set definition, review ordering, ~1/10 rate, set-exit on solve.
- **#76** [core][bug] -- **tuck-seeking lateral (fix unreachable right-side J tucks).** In `packages/core/src/placement.ts`, change `moveToColumn` (and thus `lateralMove` + the mobile drag path) from "fits at current row, else ride up to the top" to **"move to the reachable position in the target column nearest the current row, preferring at-or-below (tuck in); ride up only when nothing at-or-below is reachable"** — pick from `reachableStates` so the superset/soundness invariant holds. Autonomous. Tests: all existing #68 lateral tests still pass; pocket tuck no longer ejects; **new navigation-completeness property test** (BFS over actual input moves reaches every `enumerateResting` placement); **puzzle 1374 regression** (pull from live bank; if unavailable synthesize a right-side-overhang J board and note it).
- **#79** [play] -- **results: puzzle rating + live community-correct-%.** New data-access `getPuzzleSolveStats(puzzleId)` → `{ total, solved }` (count over `attempts`, `solved = score>=97`), computed **live at results time** (the just-finished attempt is included). Results/feedback panel renders `glicko.rating` + `X% (N)` correct, **always with the sample size**. Autonomous. Tests: stat fn counts correctly; results renders rating + `X% (N)`.
- **#80** [play] -- **results: 1-5 star "how fun" rating (reveal-after-rate).** New table `puzzle_star_ratings(user_id, puzzle_id, stars int check 1..5, created_at, updated_at, pk (user_id, puzzle_id))` with **own-row RLS, anonymous allowed**. data-access: `upsertStarRating`, `getMyStarRating`, `getStarStats(puzzleId)` → `{ avg, count }`. Results control: clickable 1-5 stars ("How fun was this puzzle?"), one per user, upsertable; community **avg + count hidden until the player rates**, then reveal `avg ★ (N)` live. Autonomous. Tests: upsert one-per-user; reveal-after-rate; RLS own-row.

**Schema/DB note:** #80 adds a table; #74/#75/#79 are **read-only** queries over `attempts` (no schema change). Apply DDL via `psql "$DATABASE_URL"`. **No bank regeneration this run** — there is no StackRabbit/BetaTetris generation step. **Defensive backup before any DDL:** `create table if not exists puzzles_bak_20260623_grill7 as select * from puzzles;`. **Never drop** any `*_bak_*` / `*_quarantine_*` table.

**Engine stays OFFLINE / generator-only** (StackRabbit at `$STACKRABBIT_URL`; BetaTetris via `bt-run`) -- never called from `apps/play`. **Do NOT deploy, push, or host** -- the push + GitHub Pages redeploy stay a manual step after this run (`/push-deploy-sandcastle`).

When the autonomous set **#74, #75, #76, #79, #80** are all closed -- or you are genuinely blocked and have left a comment -- output the completion signal. **#77 (and its dependent #78) are the expected supervised blockers**: leave them OPEN with a precise owner-action comment rather than forcing them closed. Only leave an issue open for a *genuine* blocker.

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

When all actionable issues are complete (or you are blocked on all remaining ones), or the open-issues block at the top of this prompt is empty, output the completion signal:

<promise>COMPLETE</promise>
