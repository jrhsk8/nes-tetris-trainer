/**
 * Rating glue (#6) — the thin custom layer mapping a puzzle outcome to a
 * Glicko-2 update for both the player and the puzzle, and persisting the
 * player's new rating (docs/PRD-v1.md, "Rating").
 *
 * The Glicko-2 math is off-the-shelf (`glicko2-lite`); the only custom code is
 * the outcome -> match-result mapping and the persistence wiring.
 */

import { glicko2 } from 'glicko2-lite';
import {
  SEED_RATING,
  SEED_DEVIATION,
  SEED_VOLATILITY,
  type DataAccess,
  type Glicko,
} from '@trainer/data';

/** Glicko-2 system constant (tau) constraining volatility change. */
export const GLICKO_TAU = 0.5;

/** New ratings for both sides after one attempt. */
export interface RatingUpdate {
  /** The player's new rating. */
  user: Glicko;
  /** The puzzle's new rating (computed here; persisted later — see #2/#9). */
  puzzle: Glicko;
}

function toGlicko(result: { rating: number; rd: number; vol: number }): Glicko {
  return { rating: result.rating, deviation: result.rd, volatility: result.vol };
}

/**
 * Pure co-rating update: treat the attempt as a single Glicko-2 match between
 * the player and the puzzle. `solved` is a player win (score 1) and a puzzle
 * loss; a failure is the reverse. Returns both sides' new ratings.
 */
export function updateRatings(user: Glicko, puzzle: Glicko, solved: boolean): RatingUpdate {
  const userScore = solved ? 1 : 0;
  const puzzleScore = solved ? 0 : 1;
  const userResult = glicko2(
    user.rating,
    user.deviation,
    user.volatility,
    [[puzzle.rating, puzzle.deviation, userScore]],
    { tau: GLICKO_TAU },
  );
  const puzzleResult = glicko2(
    puzzle.rating,
    puzzle.deviation,
    puzzle.volatility,
    [[user.rating, user.deviation, puzzleScore]],
    { tau: GLICKO_TAU },
  );
  return { user: toGlicko(userResult), puzzle: toGlicko(puzzleResult) };
}

/** The persisted rating change from one attempt. */
export interface AttemptRatingResult {
  /** The player's rating before the attempt (seeded if they had none). */
  before: Glicko;
  /** The player's rating after the attempt (now persisted). */
  after: Glicko;
  /** Signed rating change, positive on a win. */
  delta: number;
  /** The puzzle's new rating (computed; persistence wired for later). */
  puzzle: Glicko;
}

/** The seed rating a player starts at before their first attempt. */
export function seedRating(): Glicko {
  return { rating: SEED_RATING, deviation: SEED_DEVIATION, volatility: SEED_VOLATILITY };
}

/**
 * Apply a graded attempt to the player's rating and persist it. Reads the
 * player's current rating (seeding it on first play), computes the co-rating
 * update against the puzzle's rating, writes the player's new rating, and
 * returns the change. The puzzle's drifted rating is computed and returned but
 * not yet persisted (deferred until there is enough traffic — PRD "Rating").
 */
export async function applyAttempt(
  db: Pick<DataAccess, 'getUserRating' | 'upsertUserRating'>,
  userId: string,
  puzzleRating: Glicko,
  solved: boolean,
): Promise<AttemptRatingResult> {
  const existing = await db.getUserRating(userId);
  const before: Glicko = existing
    ? { rating: existing.rating, deviation: existing.deviation, volatility: existing.volatility }
    : seedRating();

  const update = updateRatings(before, puzzleRating, solved);
  await db.upsertUserRating({ userId, ...update.user });

  return {
    before,
    after: update.user,
    delta: update.user.rating - before.rating,
    puzzle: update.puzzle,
  };
}
