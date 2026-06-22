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
- **BetaTetris cross-check engine (issue #54)** — now baked into the image (offline, CPU):
  - A userspace micromamba env `bt` (python 3.12 + pytorch-cpu) + the built `tetris` C++ extension + the v1.0.0 perfect/normal weights. Run scripts inside it with the `bt-run` wrapper, e.g. `bt-run python betatetris-spike/pull.py && bt-run python betatetris-spike/compare.py`.
  - Paths are in the env: `BT_HOME`, `BT_REPO_PY`, `BT_MODELS`, `BT_OUT`. Method/verdict: `docs/decisions.md` (2026-06-21 — Consensus bank); harness + paths table + board-injection gotchas: `betatetris-spike/README.md`.
  - Same guardrail as StackRabbit: **offline / generator-only** (and GPLv3 — never link it into or ship it with the play app).

## Run scope (this run)

This is the **2026-06-21 consensus-bank batch** — four issues (#51–#54) from a `/grill-with-docs` design session that followed the BetaTetris cross-check spike. They move the bank toward *quality-graded rating + difficulty-by-tightness + a deeper-confirmed optimal + a BetaTetris-blessed consensus filter*. Rationale: `docs/decisions.md` (2026-06-21 — Consensus bank). All prior batches (#1–#50) are **closed**.

- **Issues (this batch — work top-to-bottom):**
  - **#51** `[play]` — graded reward curve: replace the binary `solved?0:1` Glicko outcome with a quality-graded `scoreToOutcome(score)` (95 = neutral, convex up to 100, steep-below to a 0.10 floor) in `packages/rating` (live + offline `tally.ts`); persist a numeric `attempts.score` (additive migration); the play UI shows graded credit. Detail in the issue body.
  - **#52** `[generator]` — enforce difficulty bands by measured `acceptCount` (hard = ≤ ~2 acceptable answers); generation deliberately spans easy→hard. Reshapes the bank → **regen**.
  - **#53** `[generator]` — deeper-StackRabbit best-confirm gate (`playoutCount>0`) that re-ranks/rejects eval-only-quirk optimals. Reshapes the bank → **regen**.
  - **#54** `[generator]` — BetaTetris true-consensus filter. The offline BetaTetris build is **now provisioned in this sandbox** (baked into the image; see the resources section above), so this is **in scope** for autonomous work. **Do #54 last**, after #51–#53 close — it depends on the deeper-confirmed optimal (#53) and the difficulty bands (#52). **Phase 1 first: measure the keep-rate** (reuse `betatetris-spike/{pull,compare}.py` via `bt-run`) and post the number on the issue; only build the Phase-2 generation gate if the keep-rate is workable (a smaller, more tactical bank is acceptable). If the BetaTetris env smoke-check failed at sandbox start, leave a blocker comment and move on rather than thrashing.
- **Bank regen — #52 AND #53 reshape which candidates survive + `combos`/difficulty.** **Back up first** (`create table if not exists puzzles_bak_<date> as select * from puzzles`). Regen is additive in form — `boardKey`s and placements are unchanged; only which candidates survive + their scores/difficulty change. If both run in one launch, the later regen incorporates both. The live bank is currently **309**. **Do NOT drop any `*_bak_*` or `*_quarantine_*` table.**
- **#51's migration is additive** — `alter table public.attempts add column if not exists score double precision`; re-running `schema.sql` stays safe.
- **Engine stays OFFLINE / generator-only** (StackRabbit at `$STACKRABBIT_URL`); never call it from the play app. Supabase **anonymous sign-ins are ENABLED** (not a blocker).
- **Do NOT deploy, push, or host.** The push + GitHub Pages redeploy stay a manual step after this run.
- When **#51–#54** are all closed (or you are blocked on the remaining one and have left a comment), output the completion signal.

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
