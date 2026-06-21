/**
 * Per-puzzle difficulty (#40, v2 overhaul issue D).
 *
 * Difficulty is a GENERATION property (docs/decisions.md 2026-06-21): "few
 * acceptable answers and/or a large gap = hard." It is computed from the
 * field-normalized 0–100 combo scores as two raw signals, stored on the puzzle,
 * and mapped to the puzzle's **seed rating** so matchmaking (#44) works
 * immediately, before any crowd data:
 *
 *  - `acceptCount` — how many distinct combos score ≥ the accept threshold (95).
 *    Fewer acceptable answers ⇒ harder.
 *  - `margin` — the gap between the best combo (always 100) and the best one
 *    *below* the accept threshold. A large gap ⇒ the few good answers are sharply
 *    separated from the rest ⇒ harder.
 *
 * Harder maps to a HIGHER seed rating; the mapping is biased hard with an easy
 * tail kept for low-rated / new players (the relaxed board-health floor lets
 * easy boards through, #40).
 */

import { CORRECT_SCORE_THRESHOLD } from '@trainer/core';

/** The raw difficulty signals stored on a puzzle. */
export interface Difficulty {
  /** Distinct combos scoring ≥ {@link CORRECT_SCORE_THRESHOLD}. Always ≥ 1. */
  acceptCount: number;
  /** 100 minus the best score strictly below the accept threshold (0..100). */
  margin: number;
}

/** Seed rating for the easiest puzzles (many acceptable answers, small margin). */
export const EASY_SEED = 1300;
/** Seed rating for the hardest puzzles (one acceptable answer, large margin). */
export const HARD_SEED = 1700;

// --- Difficulty bands by answer-set tightness (#52) -------------------------
// Difficulty is bucketed by the *measured* `acceptCount`, not by board shape: a
// tough-looking board with many acceptable combos is still easy. The bands are
// named, tunable cutoffs, and the seed-rating mapping below is aligned to them
// so a puzzle's band and its seed rating track each other (docs/decisions.md
// 2026-06-21 — Consensus bank).

/** A puzzle's difficulty band, derived from its acceptable-answer count. */
export type DifficultyBand = 'easy' | 'medium' | 'hard';

/** Bands in easy→hard order (the spread a generated bank should span). */
export const DIFFICULTY_BANDS: readonly DifficultyBand[] = ['easy', 'medium', 'hard'];

/** Hard = a genuinely tight answer set: at most this many acceptable combos. */
export const HARD_MAX_ACCEPTS = 2;
/** Easy = at least this many acceptable combos (anything in between is medium). */
export const EASY_MIN_ACCEPTS = 8;

/** Bucket a puzzle into its difficulty band from its measured `acceptCount`. */
export function bandFor(acceptCount: number): DifficultyBand {
  if (acceptCount <= HARD_MAX_ACCEPTS) return 'hard';
  if (acceptCount >= EASY_MIN_ACCEPTS) return 'easy';
  return 'medium';
}

/**
 * At or above this many acceptable answers, the accept axis is fully "easy".
 * Aligned to {@link EASY_MIN_ACCEPTS} so the easy band maps to {@link EASY_SEED}.
 */
const ACCEPTS_EASY = EASY_MIN_ACCEPTS;
/** At or above this margin, the margin axis is fully "hard". */
const MARGIN_HARD = 60;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Compute the difficulty signals from a puzzle's field-normalized 0–100 combo
 * scores (best-first; the first is always 100). `acceptCount` is the count ≥ 95;
 * `margin` is 100 minus the best score below 95 (or 0 when every combo passes —
 * a trivially easy puzzle with no separation).
 */
export function difficultyFromScores(scores: readonly number[]): Difficulty {
  const acceptCount = scores.filter((s) => s >= CORRECT_SCORE_THRESHOLD).length;
  const below = scores.filter((s) => s < CORRECT_SCORE_THRESHOLD);
  const bestBelow = below.length > 0 ? Math.max(...below) : 100;
  const margin = 100 - bestBelow;
  return { acceptCount, margin };
}

/**
 * Map difficulty signals to a seed rating in [{@link EASY_SEED},
 * {@link HARD_SEED}]. Fewer acceptable answers and a larger margin both push the
 * seed higher (harder); the accept axis is weighted slightly more than the
 * margin axis.
 */
export function seedRatingFor(d: Difficulty): number {
  const acceptFactor = clamp01((ACCEPTS_EASY - d.acceptCount) / (ACCEPTS_EASY - 1));
  const marginFactor = clamp01(d.margin / MARGIN_HARD);
  const difficulty = clamp01(0.6 * acceptFactor + 0.4 * marginFactor);
  return Math.round(EASY_SEED + difficulty * (HARD_SEED - EASY_SEED));
}
