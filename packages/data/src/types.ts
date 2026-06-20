/**
 * Domain + row types for the shared data layer (#2). The domain types are what
 * the app and generator work with; the `*Row` types mirror the Postgres column
 * names and are mapped to/from domain types in the data-access layer.
 */

import type { Line } from '@trainer/core';
import type { BoardMetrics } from '@trainer/core';
import type { Piece } from '@trainer/core';
import type { Placement } from '@trainer/core';

/** Glicko-2 rating triple carried by both players and puzzles. */
export interface Glicko {
  rating: number;
  deviation: number;
  volatility: number;
}

/** A stored puzzle: everything the play app needs with no engine at runtime. */
export interface Puzzle {
  id: string;
  /** 200-char board encoding (see @trainer/core board model). */
  board: string;
  piece1: Piece;
  piece2: Piece;
  /** The optimal two-ply line. */
  optimalLine: Line;
  /** Precomputed metrics of the optimal result board. */
  optimalMetrics: BoardMetrics;
  /** Puzzle co-rating (flat seed at generation; drifts later). */
  glicko: Glicko;
}

/** The fields needed to create a puzzle (id and rating default server-side). */
export interface NewPuzzle {
  board: string;
  piece1: Piece;
  piece2: Piece;
  optimalLine: Line;
  optimalMetrics: BoardMetrics;
  /** Optional seed rating; defaults to the flat seed if omitted. */
  glicko?: Partial<Glicko>;
}

/** A user's persisted rating. */
export interface UserRating extends Glicko {
  userId: string;
}

/**
 * A recorded attempt. `userLine` holds the placements the player actually made:
 * two on a completed puzzle, or one when a wrong first move ended it early.
 */
export interface Attempt {
  id: string;
  userId: string;
  puzzleId: string;
  userLine: readonly Placement[];
  solved: boolean;
  createdAt: string;
}

/** The fields needed to record an attempt. */
export interface NewAttempt {
  userId: string;
  puzzleId: string;
  userLine: readonly Placement[];
  solved: boolean;
}

// --- Postgres row shapes (snake_case, as returned by supabase-js). ---

export interface PuzzleRow {
  id: string;
  board: string;
  piece1: string;
  piece2: string;
  optimal_line: Line;
  optimal_metrics: BoardMetrics;
  rating: number;
  deviation: number;
  volatility: number;
  created_at: string;
}

export interface UserRatingRow {
  user_id: string;
  rating: number;
  deviation: number;
  volatility: number;
  updated_at: string;
}

export interface AttemptRow {
  id: string;
  user_id: string;
  puzzle_id: string;
  user_line: readonly Placement[];
  solved: boolean;
  created_at: string;
}
