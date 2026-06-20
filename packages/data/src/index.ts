/**
 * @trainer/data — the typed Supabase data-access layer shared by the play app
 * and the offline generator (#2). The schema lives in `schema.sql`.
 */

export {
  createDataAccess,
  createSupabaseClient,
  SEED_RATING,
  SEED_DEVIATION,
  SEED_VOLATILITY,
} from './data-access.js';
export type { DataAccess } from './data-access.js';
export type {
  Glicko,
  Puzzle,
  NewPuzzle,
  UserRating,
  Attempt,
  NewAttempt,
  PuzzleRow,
  UserRatingRow,
  AttemptRow,
} from './types.js';
