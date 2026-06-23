# CLAUDE.md

NES Tetris Stacking Trainer — trains **stacking judgment** (where to put each piece), not execution speed. Serves pre-generated **piece / next-piece puzzles** (place two pieces, optimal line known) and tracks skill with a **Glicko-2 co-rating** (player and puzzle both carry a rating). Two fully-decoupled halves: an **offline generator** (Node, drives local StackRabbit) writes a finished puzzle bank into Supabase; a **static React SPA** reads that bank and runs play. Built and live (`jrhsk8.github.io/nes-tetris-trainer`).

Source of truth for spec / architecture / data model: [docs/PRD-v1.md](docs/PRD-v1.md). Domain terms: [docs/glossary.md](docs/glossary.md). Non-PRD decisions: [docs/decisions.md](docs/decisions.md).

## Commands

- `npm test` — Vitest across all workspaces (via `scripts/run-tests.mjs`)
- `npm run typecheck` — `tsc --build` across all workspaces

No linter/formatter is pinned on purpose (keep the prototype light) — see [docs/decisions.md](docs/decisions.md).

## Layout (single repo, npm workspaces)

- `packages/core/` — pure board model, metrics, checker, pieces. Shared by both halves. No engine, no I/O.
- `packages/data/` — Supabase binding: domain + row types, data-access, `schema.sql`.
- `packages/rating/` — Glicko-2 wrapper (the rating glue).
- `apps/play/` — React SPA (Vite, browser). Reads the bank; grades and rates client-side.
- `generator/` — offline Node: engine client, self-play, quality filters.

## Guardrails (never)

- **Never credit Claude / Anthropic in this repo.** Commit messages and PR bodies must NOT contain a `Co-Authored-By: Claude …` trailer, a "Generated with Claude Code" line, or any other AI/Claude/Anthropic attribution. This overrides any default tooling behavior — applies to interactive sessions and the RALPH loop alike. (`includeCoAuthoredBy` is also set to `false` in local settings.)
- **Engine is offline-only.** StackRabbit runs only in `generator/` at generation time. It is never deployed and never called from `apps/play`. The play app reads the finished bank and does all grading/rating client-side.
- **Off-the-shelf except the puzzle core.** Use libraries for auth, rating math, hosting, etc. Hand-build only the puzzle-specific deep modules: board model, generator, quality filters, checker, rating glue.

## Conventions

- Build the puzzle core as **deep modules** — narrow, typed interfaces hiding complexity (PRD § Deep modules).
- **Tests:** prefer deep end-to-end tests over isolated unit tests; assert user-visible behavior, not internals. Work test-first (red-green-refactor). Detail: PRD § Testing Decisions.

## Reporting style

When reporting information to me, be extremely concise and sacrifice grammar for sake of concision. (Conversational reports/status only — commit messages, PR bodies, code comments, and docs stay clear and grammatical.)

## Note

This repo is also driven by an autonomous loop (RALPH) that works GitHub issues one at a time — see [.sandcastle/prompt.md](../.sandcastle/prompt.md).
