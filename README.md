# NES Tetris Stacking Trainer

A public, multi-user web app that serves pre-generated **2-ply NES Tetris placement puzzles** and tracks each player's stacking skill with a **Glicko co-rating**. The goal is to train _stacking judgment_ — where to put each piece — independent of execution speed.

> **v1 is a working prototype of the core loop.** See the full spec: [`.claude/docs/PRD-v1.md`](.claude/docs/PRD-v1.md).

## How it works (two decoupled halves)

- **Offline generation** (developer-run): drives a local [StackRabbit](https://github.com/GregoryCannon/StackRabbit) engine via simulated semi-random self-play, snapshots realistic mid-game boards, applies quality gates (Hz-invariance, board-health, BetaTetris consensus, deduplication), and writes a finished puzzle bank — including tuck/spin placements and auto-computed type-tags — into Supabase. The engine is never deployed.
- **Play app** (static React SPA + Supabase): reads the finished bank. Players pilot a free-floating piece outline to a resting placement (including tucks and spins); grading is by combo-score threshold (score ≥ 97 = A+ = correct); a Glicko-2 update moves the player's rating; feedback shows letter grades and a ranked combo list.

## Stack

- Front end: plain React SPA, static-hosted (GitHub Pages / own domain).
- Backend: Supabase (Postgres + Auth).
- Rating: Glicko-2 (npm library), client-side.
- Generator: offline Node script.

## Repository layout

npm workspaces monorepo:

- `packages/core` (`@trainer/core`) — pure puzzle logic (board model, metrics,
  combo-threshold checker, piece shapes, type-tag classifier) shared by both halves. No engine, network, or DOM.
- `packages/data` (`@trainer/data`) — Supabase binding: domain + row types, data-access.
- `packages/rating` (`@trainer/rating`) — Glicko-2 rating wrapper.
- `apps/play` (`@trainer/play`) — the static React + Vite SPA players use.
- `generator` (`@trainer/generator`) — the offline Node + TypeScript pipeline.

## Development

```bash
npm install        # install all workspaces and link @trainer/core
npm run typecheck  # tsc --build across all workspaces (project references)
npm test           # Vitest across all workspaces
npm run lint       # ESLint (flat config)
npm run format     # Prettier --write
npm run build      # static production build of apps/play (GitHub Pages-ready)
```

The play app builds with a relative `base` so the static output works both on a
GitHub Pages project subpath and on the owner's own domain.

## Status

Live at [jrhsk8.github.io/nes-tetris-trainer](https://jrhsk8.github.io/nes-tetris-trainer/) —
core puzzle logic, generator pipeline, and play UI are all in place. Ongoing work is tracked in GitHub issues.
