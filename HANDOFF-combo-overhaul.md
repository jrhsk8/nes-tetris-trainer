# Handoff — 2026-06-20 combo-grading overhaul

Run-scope for the next Sandcastle/RALPH run. Full rationale: `docs/decisions.md` (2026-06-20 "Combo-grading overhaul" entry) and the glossary (*Two-piece combo*, *Combo score*, *Combo table*, *Combo-threshold grading*, *Board-health floor*, *Verdict*, *Ranked combo list*). Tracking epic: **#36**.

## The model (one paragraph)

A puzzle becomes "find the best **two-piece combo**." The player always places both pieces — there is **no wrong-first-move short-circuit**. The attempt is the combo `(placement₁, placement₂)`, scored by StackRabbit's evaluation of the board after **both** placements, field-normalized 0–100 across the puzzle's combos (best = 100, worst legal = 0). **Correct = score ≥ 95.** The bank stores the **top-30** ranked combos per puzzle; feedback shows a Correct/Incorrect verdict banner plus a ranked top-5 list with interactive replay. Starting boards are filtered cleaner via a StackRabbit board-health floor. This supersedes the exact-match checker, the strip-plot chart (#29), and the `first_values`/`second_values` model from the first overhaul (#30).

## Issues in this batch

| Issue | Phase | Depends on | Summary |
|-------|-------|-----------|---------|
| #31 | P1 (client) | — | Fix stack reverting to white; color-aware replay (R1) |
| #32 | P1 (client) | — | Slim top bar + taller centered board, no scroll (R6) |
| #33 | P2 (offline + schema) | — | Combo bank regen: cross-product sweep, top-K combos, board-health floor, drop unambiguity gate, Hz→best-combo (R3 + data model) |
| #34 | P3 (core) | #33 (types) | Checker → combo-threshold grading, no short-circuit (R2) |
| #35 | P3 (play) | #33, #34 | Place both always + verdict banner + ranked interactive combo list (R2/R4/R5) |

## Order & dependencies

- **#31 and #32 are client-only, no bank change — do them first** (no deps). RALPH's bug-first priority will pick **#31** first (it's a bug).
- **#33 is the gate.** It blocks #34 and #35. Do it before either Phase-3 issue.
  - Nuance: #34's grading code only needs #33's **schema/types** committed, not the finished regen. If iterating, you may land #33's migration + `packages/data` types early so #34 can proceed in parallel — but the default safe path is #33 fully closed first.
- **#35 needs both #33 (combo data) and #34 (the checker)**, and reuses the color-aware replay from #31.

Suggested sequence: **#31 → #32 → #33 → #34 → #35.**

## #33 specifics (the regen)

- **Back up the bank first** (full export of `puzzles`), as on #27. Replacing the bank cascade-deletes `attempts` — expected and accepted.
- **Schema:** `alter table puzzles add column if not exists combos jsonb`. Keep `colors`. Stop populating `first_values`/`second_values` (leave nullable, or drop only if clearly safe).
- **Board-health floor:** keep a snapshot only if `min over the 7 piece types of getBestMove(board, piece).totalValue >= FLOOR`. `FLOOR` is **moderate + tunable** — protect yield ("don't overdo it"). Cheap geometric pre-filter (holes/bumpiness) first.
- **Combo sweep:** full cross-product per candidate; field-normalize 0–100; store **top-K = 30** (`{rot1,col1,rot2,col2,score}` + total ranked count).
- **Gates:** drop unambiguity/discrimination; keep Hz-invariance retargeted to the **best combo** being identical at slow-tap and fast-DAS.
- Regenerate the full bank (≥ current count), **replace** (clear + write), update `packages/data` types/mappers. Keep the binary `Grid` color-blind.

## Environment / resources (already provisioned in the sandbox)

- **Supabase:** `DATABASE_URL` (session-pooler, port 5432, supports DDL — use for the migration), `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY` (server/generator only), `SUPABASE_URL`, anon/publishable key. `psql` installed. Never commit secrets.
- **StackRabbit:** running at `STACKRABBIT_URL` (`http://127.0.0.1:3000`, health `GET /ping`). Generator-only — wrap behind the typed client; never call from the play app.

## Guardrails for this run

- One issue per iteration; RGR (red→green→refactor); `npm run typecheck` + `npm run test` before each commit; `RALPH:` commit prefix.
- **Do NOT deploy or host.** The GitHub Pages redeploy stays a manual step after this run.
- When #31–#35 are all closed (and no other actionable issues remain), output `<promise>COMPLETE</promise>`.
