/**
 * Offline puzzle-rating tally command (#41, v2 overhaul issue E) — recompute
 * every attempted puzzle's Glicko-2 rating in a single **rating period** from the
 * recorded `attempts`, and persist the new ratings. This is the batch counterpart
 * to the per-attempt player update the play app applies live; the engine is not
 * involved (offline-only, but engine-free).
 *
 * The rating math is the off-the-shelf glue in `@trainer/rating`; this module is
 * the thin DB wiring: read the puzzles, attempts, and player ratings, run the
 * pure {@link tallyPuzzleRatings}, and write each changed puzzle back.
 */

import type { DataAccess, Glicko } from '@trainer/data';
import { tallyPuzzleRatings, type TallyAttempt } from '@trainer/rating';

/** The data-access surface a tally run needs. */
export type TallyDeps = Pick<
  DataAccess,
  'getAllPuzzleRatings' | 'getAllAttempts' | 'getAllUserRatings' | 'updatePuzzleRating'
>;

/** Summary of a tally run. */
export interface TallyResult {
  /** Puzzles considered (the whole bank). */
  puzzles: number;
  /** Attempts folded into the rating periods. */
  attempts: number;
  /** Puzzles whose rating was recomputed and written (those with ≥ 1 attempt). */
  updated: number;
}

/**
 * Recompute and persist puzzle ratings from the attempt log. Reads the current
 * bank ratings, the full attempt log, and every player rating; folds each
 * puzzle's attempts into one Glicko-2 rating period; writes back only the puzzles
 * that saw attempts (untouched puzzles keep their seed rating). Idempotent given
 * the same attempt log.
 */
export async function tallyBankRatings(
  deps: TallyDeps,
  onProgress: (message: string) => void = () => {},
): Promise<TallyResult> {
  const [puzzles, attempts, userRatings] = await Promise.all([
    deps.getAllPuzzleRatings(),
    deps.getAllAttempts(),
    deps.getAllUserRatings(),
  ]);

  const ratingByUser = new Map<string, Glicko>(
    userRatings.map((u) => [
      u.userId,
      { rating: u.rating, deviation: u.deviation, volatility: u.volatility },
    ]),
  );
  const tallyAttempts: TallyAttempt[] = attempts.map((a) => ({
    puzzleId: a.puzzleId,
    userId: a.userId,
    solved: a.solved,
    score: a.score,
  }));

  const updated = tallyPuzzleRatings(puzzles, tallyAttempts, ratingByUser);
  onProgress(
    `tallying ${attempts.length} attempts over ${puzzles.length} puzzles → ${updated.size} to update`,
  );

  for (const [id, glicko] of updated) {
    await deps.updatePuzzleRating(id, glicko);
  }

  return { puzzles: puzzles.length, attempts: attempts.length, updated: updated.size };
}
