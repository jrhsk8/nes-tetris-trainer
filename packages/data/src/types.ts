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

/**
 * A legal placement and its engine value, one row of a puzzle's value table
 * (#27/#29). `rotation`/`col` are in the app's own placement coordinates (the
 * same as {@link Line} entries), so the play app can look up a player's move by
 * its (rotation, col). Higher `value` is better.
 *
 * @deprecated Superseded by the two-piece {@link ComboTable} (#33). Kept on the
 * domain/row types so the older strip-plot chart keeps compiling until the
 * ranked-combo list (#35) replaces it; the combo regen stops populating it.
 */
export interface PlacementValue {
  rotation: number;
  col: number;
  value: number;
}

/**
 * One ranked two-piece combo (#33): the placement of piece 1 (`rot1`/`col1`)
 * and piece 2 (`rot2`/`col2`), both in the app's placement coordinates (the same
 * as {@link Line} entries), with a field-normalized 0–100 `score` (best combo on
 * the puzzle = 100, worst legal = 0). Higher is better.
 */
export interface ComboEntry {
  rot1: number;
  col1: number;
  rot2: number;
  col2: number;
  score: number;
}

/**
 * A puzzle's stored combo table (#33): the top-K ranked two-piece combos sorted
 * by `score` descending (rank-1 first, scoring 100), plus the total number of
 * ranked (legal, engine-valued) combos the generator found — so the play app can
 * report a player's exact rank or "too low to rank" when their combo falls
 * beyond the stored top-K. Combo-threshold grading (#34) reads this; no engine
 * runs at play time.
 */
export interface ComboTable {
  /** The top-K combos, best-first (rank 1 = index 0). */
  entries: ComboEntry[];
  /** Total ranked combos found at generation (≥ `entries.length`). */
  total: number;
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
  /**
   * 200-char colour grid parallel to `board` (#28): `'0'` empty, `'1'`/`'2'`/`'3'`
   * the NES colour group that filled each cell. Empty string for legacy puzzles
   * generated before the colour-tracking regen.
   */
  colors: string;
  /**
   * The ranked two-piece combo table (#33): the top-K combos + total ranked
   * count. Combo-threshold grading (#34) and the ranked-combo list (#35) read
   * this. Empty (`{ entries: [], total: 0 }`) for legacy puzzles generated
   * before the combo regen.
   */
  combos: ComboTable;
  /**
   * @deprecated Superseded by {@link combos} (#33). Empty for combo-era puzzles.
   * Every legal placement of `piece1` with its engine value (#29).
   */
  firstValues: PlacementValue[];
  /**
   * @deprecated Superseded by {@link combos} (#33). Empty for combo-era puzzles.
   * Every legal placement of `piece2` on the post-first-move board (#29).
   */
  secondValues: PlacementValue[];
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
  /** 200-char colour grid parallel to `board` (#28); omitted for legacy rows. */
  colors?: string;
  /** The ranked two-piece combo table (#33); omitted for legacy rows. */
  combos?: ComboTable;
  /** @deprecated Value table for piece 1 (#29); no longer populated (#33). */
  firstValues?: PlacementValue[];
  /** @deprecated Value table for piece 2 (#29); no longer populated (#33). */
  secondValues?: PlacementValue[];
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
  /** The player's rating immediately after this attempt (the trend point). */
  ratingAfter: number | null;
  createdAt: string;
}

/**
 * A user's persisted preferences (#24). `bindings` is an action→key map; the
 * data layer keeps it as an opaque string map so the app owns the action set.
 */
export interface UserPrefs {
  userId: string;
  bindings: Record<string, string>;
}

/**
 * An attempt enriched with its puzzle's current rating for the History view
 * (#26). Difficulty is not stored on the attempt; it is read by joining to the
 * puzzle, and is null when the puzzle no longer exists (orphaned attempt).
 */
export interface AttemptHistoryEntry extends Attempt {
  difficulty: number | null;
}

/** The fields needed to record an attempt. */
export interface NewAttempt {
  userId: string;
  puzzleId: string;
  userLine: readonly Placement[];
  solved: boolean;
  /** The player's rating after this attempt, for the rating history (#13). */
  ratingAfter?: number;
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
  /** 200-char colour grid (#28); null for legacy rows. */
  colors: string | null;
  /** The ranked two-piece combo table (#33); null for legacy rows. */
  combos: ComboTable | null;
  /** @deprecated Value table for piece 1 (#29); null for combo-era rows. */
  first_values: PlacementValue[] | null;
  /** @deprecated Value table for piece 2 (#29); null for combo-era rows. */
  second_values: PlacementValue[] | null;
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
  rating_after: number | null;
  created_at: string;
}

export interface UserPrefsRow {
  user_id: string;
  bindings: Record<string, string>;
  updated_at: string;
}
