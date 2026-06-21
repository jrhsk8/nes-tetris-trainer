/**
 * @trainer/rating — Glicko-2 co-rating glue (#6). Maps a puzzle outcome to a
 * rating update for the player and the puzzle and persists the player's rating.
 */

export {
  updateRatings,
  applyAttempt,
  seedRating,
  GLICKO_TAU,
  scoreToOutcome,
  attemptOutcome,
  NEUTRAL_OUTCOME,
  NEUTRAL_SCORE,
  MAX_SCORE,
  OUTCOME_FLOOR,
  BELOW_NEUTRAL_SLOPE,
} from './glicko.js';
export type { RatingUpdate, AttemptRatingResult } from './glicko.js';
export { ratePeriod, tallyPuzzleRatings } from './tally.js';
export type { RatingPeriodMatch, TallyAttempt } from './tally.js';
