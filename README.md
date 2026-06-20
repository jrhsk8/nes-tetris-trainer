# NES Tetris Stacking Trainer

A public, multi-user web app that serves pre-generated **2-ply NES Tetris placement puzzles** and tracks each player's stacking skill with a **Glicko co-rating**. The goal is to train *stacking judgment* — where to put each piece — independent of execution speed.

> **v1 is a working prototype of the core loop.** See the full spec: [`docs/PRD-v1.md`](docs/PRD-v1.md).

## How it works (two decoupled halves)

- **Offline generation** (developer-run): drives a local [StackRabbit](https://github.com/GregoryCannon/StackRabbit) engine via simulated semi-random self-play, snapshots realistic mid-game boards, keeps only **unambiguous** and **Hz-invariant** positions, and writes a finished puzzle bank into Supabase. The engine is never deployed.
- **Play app** (static React SPA + Supabase): reads the finished bank. Players position a ghost piece to a final resting placement; grading is exact-match on both plies; a Glicko-2 update moves the player's rating; feedback animates the optimal line and shows geometric metric deltas.

## Stack

- Front end: plain React SPA, static-hosted (GitHub Pages / own domain).
- Backend: Supabase (Postgres + Auth).
- Rating: Glicko-2 (npm library), client-side.
- Generator: offline Node script.

## Status

Net-new — PRD written, implementation not yet started.
