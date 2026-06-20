/**
 * Board source (#8) — produces realistic mid-game candidate boards for the
 * generation pipeline (docs/PRD-v1.md, "Generation").
 *
 * `BoardSource` is the pluggable abstraction the rest of the pipeline (#9)
 * depends on. Self-play is the only implementation in v1; real-gameplay-derived
 * boards are anticipated later behind this same interface.
 */

import type { Grid, Piece } from '@trainer/core';

/**
 * A candidate position to turn into a puzzle: a mid-game board plus the two
 * pieces the player would be asked to place, and the level/lines context the
 * engine needs to evaluate it.
 */
export interface Candidate {
  /** The mid-game board snapshot. */
  board: Grid;
  /** The piece to place first (the puzzle's current piece). */
  currentPiece: Piece;
  /** The piece shown as next (the second ply's piece). */
  nextPiece: Piece;
  /** NES level the position was played at. */
  level: number;
  /** Lines cleared in the playout up to the snapshot. */
  lines: number;
}

/**
 * A pluggable source of candidate boards. `next()` yields the next candidate,
 * or `null` when the source is exhausted (self-play is effectively unbounded,
 * but a finite real-gameplay source would signal completion this way).
 */
export interface BoardSource {
  next(): Promise<Candidate | null>;
}
