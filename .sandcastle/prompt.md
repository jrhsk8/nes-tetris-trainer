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

## Run scope (this run)

This is the **2026-06-21 v2 overhaul batch** — extending the already-shipped combo model with outcome-by-resulting-board matching, tucks/spins, generation-time difficulty, rating-matched selection with anti-repeat, near-duplicate rejection, working rating persistence, and screenshot submission. Full detail: `HANDOFF-v2-overhaul.md` and `docs/decisions.md` (2026-06-21 "v2 overhaul" entry). All prior batches (#1–#36) are closed.

- **⚠️ The combo-grading overhaul #31–#35 (epic #36) IS implemented and deployed** — origin/main (`56ef029`) has `combos` in the schema, `packages/core/src/combo.ts`, `generator/src/pipeline/combo.ts`, the combo-threshold checker (the v1 `checker.ts` is **gone**), and `ComboList.tsx`. v2 **extends** this model — it does not rebuild it. The real v1 surfaces left to fix are: hard-drop-only enumeration + input (no tucks), no dedup/difficulty/matchmaking, and unpersisted player ratings. **Do not reopen #31–#35; do not hunt for a v1 `checker.ts`.**
- **Issues (v2 set):** A=#37 (core/placement), B=#38 (infra/schema), C=#39 (play/bug — anon-auth+persistence), D=#40 (generator/sweep), E=#41 (generator/regen), F=#42 (core·play/matching), G=#43 (play/input), H=#44 (play/matchmaking), I=#45 (play·generator/submission). Epic #46 is the tracker (already closed). Per-issue scope is in `HANDOFF-v2-overhaul.md`.
- **Order: A → B → C → D → E → F → G → H → I** — `Blocked by` lines are authoritative. A (core placement/reachability) and B (schema + RLS) have no deps; **C** is the rating-persistence bug, blocked by B; **D/E** are the offline generator rewrite + full bank regen and block the play features (**F**, **H**) and submission (**I**); **G** needs only A; **I** (OCR) is last.
- **Binding invariants:** the engine stays **offline** (submission solving happens offline; never call StackRabbit from the play app); the generator's enumerated placement set must be a **superset** of what free-positioning input can place (or outcome-matching rejects legal tucks); keep the binary `Grid` in `packages/core` colour-blind. Detail + open implementation risks (Hz operationalization, `rate-move` reachability, OCR) are in `HANDOFF-v2-overhaul.md`.
- **D/E are in scope now.** StackRabbit (`$STACKRABBIT_URL`) and Supabase (`DATABASE_URL` for DDL, `SUPABASE_SERVICE_ROLE_KEY` for admin writes) are provisioned (see *Environment / resources available*). Back up the bank before replacing it. **Enabling Supabase anonymous sign-ins is a B prerequisite** (dashboard or Management API with the service-role key; leave a blocker comment if it can't be toggled).
- **Do NOT deploy or host.** The GitHub Pages redeploy stays a manual step after this run.
- When the v2 issues are all closed, every remaining open issue is done — output the completion signal.

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
