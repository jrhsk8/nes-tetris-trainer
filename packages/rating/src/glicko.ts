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

// --- Graded reward curve (#51) ---
// The rating signal is the combo's 0–100 quality, not a binary pass/fail. The
// curve is gentle above the accept bar (a near-best answer earns a little) and
// steeper below it (a real miss is docked harder than a near-miss is rewarded),
// floored so a single bad answer can't tank a rating. Knots are named constants
// so the curve stays tunable. See docs/decisions.md (2026-06-21 — Consensus bank).

/** Player-perspective Glicko outcome for a neutral answer (no rating change). */
export const NEUTRAL_OUTCOME = 0.5;
/**
 * The accept-threshold score (combo ≥ this is a solve) — maps to neutral. Moved
 * 95 → 97 (#60, grill #5) so the rating's neutral point coincides with the A+
 * win line: ≥ 97 gains rating, < 97 docks toward the floor. The curve keeps its
 * shape; only this knot moves.
 */
export const NEUTRAL_SCORE = 97;
/** The best possible combo score (rank-1), mapping to a full win. */
export const MAX_SCORE = 100;
/** The lowest outcome a numerically-scored answer can earn (a bad-but-ranked miss). */
export const OUTCOME_FLOOR = 0.1;
/** Per-point dock applied to scores below the neutral bar. */
export const BELOW_NEUTRAL_SLOPE = 0.0267;

/**
 * Map a combo's 0–100 quality `score` to the player-perspective Glicko outcome
 * in `[OUTCOME_FLOOR, 1]` (the puzzle's perspective is `1 - outcome`):
 * - **At the bar (97):** neutral (0.5) — no rating change.
 * - **Above (convex up to 100):** `0.5 + 0.5·((score-97)/3)²` → 98≈0.56, 99≈0.72, 100=1.0.
 * - **Below (steeper, floored):** `max(0.10, 0.5 − 0.0267·(97−score))` → 95≈0.45, ≤82→0.10.
 */
export function scoreToOutcome(score: number): number {
  if (score >= NEUTRAL_SCORE) {
    const t = Math.min((score - NEUTRAL_SCORE) / (MAX_SCORE - NEUTRAL_SCORE), 1);
    return NEUTRAL_OUTCOME + NEUTRAL_OUTCOME * t * t;
  }
  return Math.max(OUTCOME_FLOOR, NEUTRAL_OUTCOME - BELOW_NEUTRAL_SLOPE * (NEUTRAL_SCORE - score));
}

/**
 * The player-perspective outcome for one attempt. Uses the graded {@link
 * scoreToOutcome} curve when a numeric combo `score` is known, and falls back to
 * the binary `solved` signal when it is absent — i.e. an unranked combo
 * (too-low-to-rank) or a legacy attempt recorded before scores were persisted.
 */
export function attemptOutcome(score: number | null, solved: boolean): number {
  return score !== null ? scoreToOutcome(score) : solved ? 1 : 0;
}

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
 * the player and the puzzle. `outcome` is the player-perspective Glicko score in
 * `[0,1]` (1 = full win, 0.5 = neutral, 0 = full loss — see {@link
 * scoreToOutcome}); the puzzle plays the complement `1 - outcome`. Returns both
 * sides' new ratings.
 */
export function updateRatings(user: Glicko, puzzle: Glicko, outcome: number): RatingUpdate {
  const userScore = outcome;
  const puzzleScore = 1 - outcome;
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
 * update against the puzzle's rating for the given `outcome` (the player-
 * perspective Glicko score in `[0,1]` — usually {@link scoreToOutcome} of the
 * attempt's combo score), writes the player's new rating, and returns the
 * change. The puzzle's drifted rating is computed and returned but not yet
 * persisted (deferred until there is enough traffic — PRD "Rating").
 */
export async function applyAttempt(
  db: Pick<DataAccess, 'getUserRating' | 'upsertUserRating'>,
  userId: string,
  puzzleRating: Glicko,
  outcome: number,
): Promise<AttemptRatingResult> {
  const existing = await db.getUserRating(userId);
  const before: Glicko = existing
    ? { rating: existing.rating, deviation: existing.deviation, volatility: existing.volatility }
    : seedRating();

  const update = updateRatings(before, puzzleRating, outcome);
  await db.upsertUserRating({ userId, ...update.user });

  return {
    before,
    after: update.user,
    delta: update.user.rating - before.rating,
    puzzle: update.puzzle,
  };
}
