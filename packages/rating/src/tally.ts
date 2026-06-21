/**
 * Offline puzzle-rating tally (#41) — recompute puzzle ratings in proper
 * Glicko-2 **rating periods** from the recorded `attempts`, rather than drifting
 * a puzzle one attempt at a time. Each puzzle is the rating subject; every player
 * who attempted it in the period is an opponent, scored from the puzzle's
 * perspective (a player solve is a puzzle loss). This is the batch counterpart to
 * the per-attempt {@link applyAttempt} used live in the play app.
 *
 * Pure math here; the offline command in `generator/` reads the rows, calls this,
 * and writes the new ratings back.
 */

import { glicko2 } from 'glicko2-lite';
import { seedRating, GLICKO_TAU } from './glicko.js';
import type { Glicko } from '@trainer/data';

/** One game in a rating period, scored from the subject's perspective. */
export interface RatingPeriodMatch {
  opponent: Glicko;
  /** Subject score: 1 = subject won, 0 = subject lost. */
  score: number;
}

function toGlicko(result: { rating: number; rd: number; vol: number }): Glicko {
  return { rating: result.rating, deviation: result.rd, volatility: result.vol };
}

/**
 * Run a single Glicko-2 rating period for one subject against all of its
 * opponents at once. A subject that played no games is returned unchanged (the
 * tally only writes puzzles that actually saw attempts, so RD-decay of idle
 * puzzles is intentionally skipped).
 */
export function ratePeriod(subject: Glicko, matches: readonly RatingPeriodMatch[]): Glicko {
  if (matches.length === 0) return subject;
  const result = glicko2(
    subject.rating,
    subject.deviation,
    subject.volatility,
    matches.map((m) => [m.opponent.rating, m.opponent.deviation, m.score] as [number, number, number]),
    { tau: GLICKO_TAU },
  );
  return toGlicko(result);
}

/** A recorded attempt reduced to what the tally needs. */
export interface TallyAttempt {
  puzzleId: string;
  userId: string;
  solved: boolean;
}

/**
 * Recompute every attempted puzzle's rating in one rating period from the full
 * attempt log. Returns a map of `puzzleId -> new rating` containing only puzzles
 * that had at least one attempt; untouched puzzles are absent (caller leaves them
 * as-is). An attempt by an unknown player is rated against a fresh seed opponent.
 */
export function tallyPuzzleRatings(
  puzzles: readonly { id: string; glicko: Glicko }[],
  attempts: readonly TallyAttempt[],
  userRatings: ReadonlyMap<string, Glicko>,
): Map<string, Glicko> {
  const byPuzzle = new Map<string, TallyAttempt[]>();
  for (const attempt of attempts) {
    const list = byPuzzle.get(attempt.puzzleId);
    if (list) list.push(attempt);
    else byPuzzle.set(attempt.puzzleId, [attempt]);
  }

  const updated = new Map<string, Glicko>();
  for (const puzzle of puzzles) {
    const atts = byPuzzle.get(puzzle.id);
    if (!atts || atts.length === 0) continue;
    const matches: RatingPeriodMatch[] = atts.map((a) => ({
      opponent: userRatings.get(a.userId) ?? seedRating(),
      // Puzzle perspective: the player solving is a loss for the puzzle.
      score: a.solved ? 0 : 1,
    }));
    updated.set(puzzle.id, ratePeriod(puzzle.glicko, matches));
  }
  return updated;
}
