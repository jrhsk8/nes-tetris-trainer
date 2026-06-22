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
  SUBMISSIONS_BUCKET,
} from './data-access.js';
export type { DataAccess } from './data-access.js';
export {
  sniffImageMime,
  extensionFor,
  ALLOWED_IMAGE_MIMES,
  MAX_UPLOAD_BYTES,
} from './image-sniff.js';
export type { AllowedImageMime } from './image-sniff.js';
export { selectMatchmadePuzzle } from './matchmaking.js';
export type { MatchmakeOptions } from './matchmaking.js';
export type {
  Glicko,
  Puzzle,
  PlacementValue,
  ComboEntry,
  ComboTable,
  NewPuzzle,
  UserRating,
  Attempt,
  NewAttempt,
  AttemptHistoryEntry,
  UserPrefs,
  PuzzleRow,
  UserRatingRow,
  AttemptRow,
  UserPrefsRow,
  Submission,
  NewSubmission,
  SubmissionStatus,
  SubmissionRow,
} from './types.js';
