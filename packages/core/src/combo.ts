/**
 * Combo-threshold grading (#34) — the two-piece combo model that supersedes the
 * exact-match checker (#5). A puzzle is "find the best two-piece combo"; the
 * player always supplies BOTH placements (there is no first-move short-circuit).
 * The attempt is graded by looking the combo up in the puzzle's stored, ranked
 * combo table (#33): a 0–100 field-normalized score (rank-1 = 100) and a 1-based
 * rank when the combo is among the stored top-K, otherwise "too low to rank".
 * Correct iff the score is at least {@link CORRECT_SCORE_THRESHOLD}.
 *
 * Pure: no engine, network, or DOM. The play app grades client-side against the
 * bank; the Glicko-2 solved/failed signal is simply {@link ComboResult.correct}.
 * See docs/decisions.md (2026-06-20 "Combo-grading overhaul") and the glossary
 * (*Combo-threshold grading*, *Combo score*, *Verdict*).
 */

import type { Line } from './board.js';

/**
 * One ranked two-piece combo: the placement of piece 1 (`rot1`/`col1`) and piece
 * 2 (`rot2`/`col2`), both in the app's (rotation, col) placement coordinates,
 * with a field-normalized 0–100 `score` (best combo on the puzzle = 100). The
 * offline generator (#33) computes and stores these; grading reads them.
 */
export interface ComboEntry {
  rot1: number;
  col1: number;
  rot2: number;
  col2: number;
  score: number;
  /**
   * Canonical outcome key (see @trainer/core `boardKey`): the resulting locked
   * cells after BOTH placements, as the 200-char board string. Populated by the
   * v2 regen (#40/#41); the matcher (#42) grades by this so tucks/spins and
   * rotation-numbering differences match by where the pieces rest. Optional for
   * legacy combo rows generated before the v2 regen.
   */
  boardKey?: string;
}

/**
 * A puzzle's stored combo table (#33): the top-K combos best-first (rank 1 =
 * index 0, scoring 100), plus the total number of ranked combos found at
 * generation — so grading can report an exact rank or "too low to rank" when a
 * combo falls beyond the stored top-K.
 */
export interface ComboTable {
  /** The top-K combos, best-first. */
  entries: ComboEntry[];
  /** Total ranked combos found at generation (≥ `entries.length`). */
  total: number;
}

/** A combo scoring at least this (0–100) counts as a correct solve. */
export const CORRECT_SCORE_THRESHOLD = 95;

/** The graded outcome of a two-piece combo attempt. */
export interface ComboResult {
  /** True iff the combo's score ≥ {@link CORRECT_SCORE_THRESHOLD} (the Glicko signal). */
  correct: boolean;
  /** The combo's 0–100 score, or `null` when it is too low to rank. */
  score: number | null;
  /** The combo's 1-based rank within the stored top-K, or `null` when unranked. */
  rank: number | null;
  /** Total ranked combos the puzzle has (the denominator for "rank N of total"). */
  total: number;
  /** True when the combo was found in the stored top-K (so rank + score are known). */
  ranked: boolean;
}

/** True if a stored combo entry is exactly the player's `(p1, p2)` line. */
function matchesLine(entry: ComboEntry, line: Line): boolean {
  const [p1, p2] = line;
  return (
    entry.rot1 === p1.rotation &&
    entry.col1 === p1.col &&
    entry.rot2 === p2.rotation &&
    entry.col2 === p2.col
  );
}

/**
 * Grade a player's two-piece `user` combo against the puzzle's stored combo
 * `table`. No first-move short-circuit — a weak first placement simply yields a
 * low or absent score. When the combo is among the stored top-K its rank +
 * score are returned (correct iff score ≥ 95); when it is beyond the top-K it is
 * "too low to rank" (no exact rank/score, never correct).
 */
export function gradeCombo(table: ComboTable, user: Line): ComboResult {
  const index = table.entries.findIndex((entry) => matchesLine(entry, user));
  if (index === -1) {
    return { correct: false, score: null, rank: null, total: table.total, ranked: false };
  }
  const { score } = table.entries[index];
  return {
    correct: score >= CORRECT_SCORE_THRESHOLD,
    score,
    rank: index + 1,
    total: table.total,
    ranked: true,
  };
}
