# NES Tetris Stacking Trainer

A public, multi-user web app that serves pre-generated **2-ply NES Tetris placement puzzles** and tracks each player's stacking skill with a **Glicko co-rating**. The goal is to train _stacking judgment_ — where to put each piece — independent of execution speed.

> **v1 is a working prototype of the core loop.** See the full spec: [`docs/PRD-v1.md`](docs/PRD-v1.md).

## How it works (two decoupled halves)

- **Offline generation** (developer-run): drives a local [StackRabbit](https://github.com/GregoryCannon/StackRabbit) engine via simulated semi-random self-play, snapshots realistic mid-game boards, keeps only **unambiguous** and **Hz-invariant** positions, and writes a finished puzzle bank into Supabase. The engine is never deployed.
- **Play app** (static React SPA + Supabase): reads the finished bank. Players position a ghost piece to a final resting placement; grading is exact-match on both plies; a Glicko-2 update moves the player's rating; feedback animates the optimal line and shows geometric metric deltas.

## Stack

- Front end: plain React SPA, static-hosted (GitHub Pages / own domain).
- Backend: Supabase (Postgres + Auth).
- Rating: Glicko-2 (npm library), client-side.
- Generator: offline Node script.

## Repository layout

npm workspaces monorepo:

- `packages/core` (`@trainer/core`) — pure puzzle logic (board model, metrics,
  checker, rating glue) shared by both halves. No engine, network, or DOM.
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

Net-new — scaffold in place (issue #1). Core puzzle logic, generator pipeline,
and play UI land in subsequent issues.
