/**
 * Domain + row types for the shared data layer (#2). The domain types are what
 * the app and generator work with; the `*Row` types mirror the Postgres column
 * names and are mapped to/from domain types in the data-access layer.
 */

import type { Line } from '@trainer/core';
import type { BoardMetrics } from '@trainer/core';
import type { Piece } from '@trainer/core';
import type { Placement } from '@trainer/core';
import type { ComboTable } from '@trainer/core';
import type { PuzzleTag } from '@trainer/core';

// The combo model is shared puzzle logic, so it lives in @trainer/core (#34);
// re-exported here for data-layer consumers that import it from @trainer/data.
export type { ComboEntry, ComboTable } from '@trainer/core';
// Puzzle type-tags (#81/#90) live in @trainer/core; re-exported for data-layer
// consumers (drill filter #85, curation analytics #87).
export type { PuzzleTag } from '@trainer/core';

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

/** A stored puzzle: everything the play app needs with no engine at runtime. */
export interface Puzzle {
  id: string;
  /**
   * Stable, human-friendly puzzle number (#49): unique, sequential (1, 2, 3 …),
   * assigned in `created_at` order and continued for new puzzles. Shown as the
   * title ("Puzzle #123") and the share-link key. Null only for legacy rows
   * generated before the numbering migration.
   */
  number: number | null;
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
   * Puzzle type-tags (#81/#90): the closed {@link PuzzleTag} set describing the
   * optimal line (and avoid-dependency contrast traps). Empty `[]` for untagged
   * / legacy rows. Drives display chips (#84), drill filtering (#85), and
   * per-type stats (#86/#87).
   */
  tags: PuzzleTag[];
  /**
   * v2 difficulty (#40): the number of combos scoring ≥ 95 (the accept count)
   * and the score `margin` between the best combo and the best below the accept
   * threshold. Raw inputs to the seed rating; null for legacy pre-v2 rows.
   */
  acceptCount: number | null;
  margin: number | null;
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
  /** Puzzle type-tags (#81/#90); omitted defaults to `[]`. */
  tags?: PuzzleTag[];
  /** v2 difficulty inputs (#40): combos ≥ 95 count and the accept-threshold margin. */
  acceptCount?: number;
  margin?: number;
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
  /** The attempt's 0–100 combo quality score (#51); null for unranked/legacy. */
  score: number | null;
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
  /**
   * Whether the NES result chiptune is muted (#61). Defaults to `false` (sound
   * on) — omittable on write, always present on read. Persisted in prefs so it
   * syncs across devices like the bindings.
   */
  muted?: boolean;
}

/**
 * An attempt enriched with its puzzle's current rating for the History view
 * (#26). Difficulty is not stored on the attempt; it is read by joining to the
 * puzzle, and is null when the puzzle no longer exists (orphaned attempt).
 */
export interface AttemptHistoryEntry extends Attempt {
  difficulty: number | null;
  /**
   * The attempted puzzle's type-tags (#86), joined for per-type accuracy stats.
   * Empty `[]` for an untagged puzzle or an orphaned attempt.
   */
  tags: PuzzleTag[];
}

/**
 * Per-type curation analytics (#87): one row per puzzle type-tag, aggregated over
 * EVERY user's flags / cull / star ratings, so the admin can pattern-mine which
 * puzzle types underperform. Carries `puzzleCount` so the UI can show rates
 * (flags / puzzles in the tag). Exposes no individual user row.
 */
export interface CurationTagStat {
  tag: PuzzleTag;
  /** Puzzles carrying this tag (the denominator for flag/cull rates). */
  puzzleCount: number;
  /** Total `flag` rows on puzzles with this tag. */
  flagCount: number;
  /** Total `cull` rows on puzzles with this tag. */
  cullCount: number;
  /** Mean star rating over puzzles with this tag (0 when none rated). */
  avgStars: number;
  /** Number of star ratings backing `avgStars`. */
  ratingCount: number;
}

/** The fields needed to record an attempt. */
export interface NewAttempt {
  userId: string;
  puzzleId: string;
  userLine: readonly Placement[];
  solved: boolean;
  /** The attempt's 0–100 combo quality score (#51); omit/null when unranked. */
  score?: number | null;
  /** The player's rating after this attempt, for the rating history (#13). */
  ratingAfter?: number;
}

// --- Postgres row shapes (snake_case, as returned by supabase-js). ---

export interface PuzzleRow {
  id: string;
  /** Stable, human-friendly puzzle number (#49); null for legacy rows. */
  number: number | null;
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
  /** Puzzle type-tags (#81/#90); `text[]` defaulting to `{}` (never null). */
  tags: string[];
  /** v2 difficulty (#40): combos ≥ 95 count; null for legacy rows. */
  accept_count: number | null;
  /** v2 difficulty (#40): accept-threshold score margin; null for legacy rows. */
  margin: number | null;
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
  score: number | null;
  rating_after: number | null;
  created_at: string;
}

export interface UserPrefsRow {
  user_id: string;
  bindings: Record<string, string>;
  muted: boolean;
  updated_at: string;
}

/**
 * A queued screenshot submission (#45, v2 overhaul issue I). The play app
 * uploads the image to Storage and inserts a `pending` row; the offline pipeline
 * OCRs, solves, and flips the status to `banked` or `rejected` (with a reason).
 */
export type SubmissionStatus = 'pending' | 'banked' | 'rejected';

export interface Submission {
  id: string;
  /** Storage object path of the uploaded screenshot. */
  imagePath: string;
  /** The submitter's user id (null for legacy/service inserts). */
  submitter: string | null;
  status: SubmissionStatus;
  /** Rejection reason when `status` is `rejected`. */
  reason: string | null;
  /** The OCR/solve result the offline pipeline attached. */
  parsed: unknown | null;
  createdAt: string;
}

/** The fields needed to enqueue a submission from the client. */
export interface NewSubmission {
  imagePath: string;
  submitter: string;
}

export interface SubmissionRow {
  id: string;
  image_path: string;
  submitter: string | null;
  status: SubmissionStatus;
  reason: string | null;
  parsed: unknown | null;
  created_at: string;
}
