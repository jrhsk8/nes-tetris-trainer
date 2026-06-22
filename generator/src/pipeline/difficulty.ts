/**
 * Per-puzzle difficulty (#40, v2 overhaul issue D; 4-band + tetris cap #71).
 *
 * Difficulty is a GENERATION property (docs/decisions.md 2026-06-21): "few
 * acceptable answers and/or a large gap = hard." It is computed from the
 * field-normalized 0–100 combo scores as two raw signals, stored on the puzzle,
 * and mapped to the puzzle's **seed rating** so matchmaking (#44) works
 * immediately, before any crowd data:
 *
 *  - `acceptCount` — how many distinct combos score ≥ the accept threshold (97).
 *    Fewer acceptable answers ⇒ harder.
 *  - `margin` — the gap between the best combo (always 100) and the best one
 *    *below* the accept threshold. A large gap ⇒ the few good answers are sharply
 *    separated from the rest ⇒ harder.
 *
 * Four bands by answer-set tightness (#71): `very-easy` / `easy` / `medium` /
 * `hard`, bucketed by `acceptCount` (very-easy = most forgiving). Harder maps to
 * a HIGHER seed rating, with the easy tail extended below `EASY_SEED` for new /
 * low-rated players.
 *
 * **Tetris cap (#71):** a puzzle where any *acceptable* combo (score ≥ 97) clears
 * a tetris (a single 4-row clear by ONE of the two placements — not a 2+2 split)
 * is capped at `easy` — never `medium`/`hard` — because the player can recognize
 * and cash the tetris to pass. `acceptCount` then picks `easy` vs `very-easy`
 * under the cap, and the seed rating is capped to the easy ceiling to match. The
 * tetris is detected offline by replaying the stored placements and counting
 * cleared rows — no StackRabbit needed.
 */

import {
  CORRECT_SCORE_THRESHOLD,
  applyRestingPlacement,
  clearFullRows,
  cloneBoard,
  enumerateResting,
  pieceCells,
  boardKey,
  type Grid,
  type Piece,
  type RestingPlacement,
} from '@trainer/core';
import type { ComboEntry } from '@trainer/data';

/** The raw difficulty signals stored on a puzzle. */
export interface Difficulty {
  /** Distinct combos scoring ≥ {@link CORRECT_SCORE_THRESHOLD}. Always ≥ 1. */
  acceptCount: number;
  /** 100 minus the best score strictly below the accept threshold (0..100). */
  margin: number;
}

/** Options that apply the tetris cap (#71) to banding / seeding. */
export interface DifficultyOptions {
  /** True if an acceptable combo clears a tetris — caps the puzzle at `easy`. */
  tetris?: boolean;
}

/** Seed rating for the easiest *capped* puzzles, below {@link EASY_SEED} (#71). */
export const VERY_EASY_SEED = 1100;
/** Seed rating for the easiest (non-very-easy) puzzles. */
export const EASY_SEED = 1300;
/** Seed rating for the hardest puzzles (one acceptable answer, large margin). */
export const HARD_SEED = 1700;

// --- Difficulty bands by answer-set tightness (#52, #71) --------------------
// Difficulty is bucketed by the *measured* `acceptCount`, not by board shape: a
// tough-looking board with many acceptable combos is still easy. The bands are
// named, tunable cutoffs, and the seed-rating mapping below is aligned to them
// so a puzzle's band and its seed rating track each other.

/** A puzzle's difficulty band, derived from its acceptable-answer count. */
export type DifficultyBand = 'very-easy' | 'easy' | 'medium' | 'hard';

/** Bands in easy→hard order (the spread a generated bank should span). */
export const DIFFICULTY_BANDS: readonly DifficultyBand[] = [
  'very-easy',
  'easy',
  'medium',
  'hard',
];

/** Hard = a genuinely tight answer set: at most this many acceptable combos. */
export const HARD_MAX_ACCEPTS = 2;
/** Easy = at least this many acceptable combos (3..7 is medium). */
export const EASY_MIN_ACCEPTS = 8;
/** Very-easy = the most forgiving: at least this many acceptable combos (#71). */
export const VERY_EASY_MIN_ACCEPTS = 16;

/** The acceptCount-only band, before the tetris cap. */
function naturalBand(acceptCount: number): DifficultyBand {
  if (acceptCount <= HARD_MAX_ACCEPTS) return 'hard';
  if (acceptCount >= VERY_EASY_MIN_ACCEPTS) return 'very-easy';
  if (acceptCount >= EASY_MIN_ACCEPTS) return 'easy';
  return 'medium';
}

/**
 * Bucket a puzzle into its difficulty band from its measured `acceptCount`, with
 * the tetris cap (#71): a tetris puzzle is never `medium`/`hard` — those collapse
 * to `easy`, while `easy`/`very-easy` keep their (more forgiving) band, so
 * `acceptCount` still picks easy vs very-easy under the cap.
 */
export function bandFor(acceptCount: number, opts: DifficultyOptions = {}): DifficultyBand {
  const natural = naturalBand(acceptCount);
  if (opts.tetris && (natural === 'medium' || natural === 'hard')) return 'easy';
  return natural;
}

/**
 * At or above this many acceptable answers, the accept axis is fully "easiest".
 * Aligned to {@link VERY_EASY_MIN_ACCEPTS} so the very-easy band maps to
 * {@link VERY_EASY_SEED}.
 */
const ACCEPTS_EASIEST = VERY_EASY_MIN_ACCEPTS;
/** At or above this margin, the margin axis is fully "hard". */
const MARGIN_HARD = 60;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Compute the difficulty signals from a puzzle's field-normalized 0–100 combo
 * scores (best-first; the first is always 100). `acceptCount` is the count ≥
 * {@link CORRECT_SCORE_THRESHOLD} (97 since #60); `margin` is 100 minus the best
 * score below that bar (or 0 when every combo passes — a trivially easy puzzle
 * with no separation).
 */
export function difficultyFromScores(scores: readonly number[]): Difficulty {
  const acceptCount = scores.filter((s) => s >= CORRECT_SCORE_THRESHOLD).length;
  const below = scores.filter((s) => s < CORRECT_SCORE_THRESHOLD);
  const bestBelow = below.length > 0 ? Math.max(...below) : 100;
  const margin = 100 - bestBelow;
  return { acceptCount, margin };
}

/**
 * Map difficulty signals to a seed rating in [{@link VERY_EASY_SEED},
 * {@link HARD_SEED}]. Fewer acceptable answers and a larger margin both push the
 * seed higher (harder); the accept axis is weighted slightly more than the margin
 * axis. With `tetris` set the seed is capped to the easy ceiling
 * ({@link EASY_SEED}), so a tetris puzzle never seeds harder than easy (#71).
 */
export function seedRatingFor(d: Difficulty, opts: DifficultyOptions = {}): number {
  const acceptFactor = clamp01((ACCEPTS_EASIEST - d.acceptCount) / (ACCEPTS_EASIEST - 1));
  const marginFactor = clamp01(d.margin / MARGIN_HARD);
  const difficulty = clamp01(0.6 * acceptFactor + 0.4 * marginFactor);
  let seed = Math.round(VERY_EASY_SEED + difficulty * (HARD_SEED - VERY_EASY_SEED));
  if (opts.tetris) seed = Math.min(seed, EASY_SEED);
  return seed;
}

// --- Tetris detection (#71) -------------------------------------------------

/**
 * Lock a resting placement into `grid` WITHOUT clearing, count the rows THIS
 * placement completed (only rows the piece itself occupies that are now full —
 * so a 4-row clear must be one piece spanning four completed rows, never a
 * pre-existing full row), then clear and return the resulting board.
 */
function lockAndClear(
  grid: Grid,
  piece: Piece,
  p: RestingPlacement,
): { cleared: number; board: Grid } {
  const next = cloneBoard(grid);
  const touchedRows = new Set<number>();
  for (const [r, c] of pieceCells(piece, p.rotation, p.row, p.col)) {
    next[r][c] = 1;
    touchedRows.add(r);
  }
  let cleared = 0;
  for (const r of touchedRows) if (next[r].every((cell) => cell)) cleared++;
  return { cleared, board: clearFullRows(next) };
}

/**
 * True if the two-piece line, played in order on `board0`, clears a **tetris** —
 * a single 4-row clear by ONE of the two placements (not a 2+2 split across both,
 * #71). Pure: replays the placements and counts cleared rows; no StackRabbit.
 */
export function lineClearsTetris(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  p1: RestingPlacement,
  p2: RestingPlacement,
): boolean {
  const a = lockAndClear(board0, piece1, p1);
  if (a.cleared === 4) return true;
  const b = lockAndClear(a.board, piece2, p2);
  return b.cleared === 4;
}

/**
 * Reconstruct a stored combo entry's resting placements (with their rows) by
 * matching its `(rotation, col)` per piece against the reachable resting set,
 * disambiguated by the entry's outcome key when present. Returns `null` when no
 * matching reachable line is found (e.g. a legacy entry with no outcome key whose
 * tuck row cannot be recovered) — the caller treats that as "not a tetris".
 */
export function restingLineForEntry(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  entry: ComboEntry,
): { p1: RestingPlacement; p2: RestingPlacement } | null {
  const p1s = enumerateResting(board0, piece1).filter(
    (p) => p.rotation === entry.rot1 && p.col === entry.col1,
  );
  for (const p1 of p1s) {
    const board1 = applyRestingPlacement(board0, piece1, p1);
    const p2s = enumerateResting(board1, piece2).filter(
      (p) => p.rotation === entry.rot2 && p.col === entry.col2,
    );
    for (const p2 of p2s) {
      if (!entry.boardKey) return { p1, p2 };
      const board2 = applyRestingPlacement(board1, piece2, p2);
      if (boardKey(board2) === entry.boardKey) return { p1, p2 };
    }
  }
  return null;
}

/** True if a single stored combo entry clears a tetris (#71). */
export function entryClearsTetris(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  entry: ComboEntry,
): boolean {
  const line = restingLineForEntry(board0, piece1, piece2, entry);
  return line ? lineClearsTetris(board0, piece1, piece2, line.p1, line.p2) : false;
}

/**
 * The tetris-cap trigger (#71): true if ANY *acceptable* stored combo (score ≥
 * {@link CORRECT_SCORE_THRESHOLD}) clears a tetris — the player can recognize and
 * cash it to pass, so the puzzle is capped at `easy`.
 */
export function clearsTetrisFromEntries(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  entries: readonly ComboEntry[],
): boolean {
  return entries.some(
    (e) => e.score >= CORRECT_SCORE_THRESHOLD && entryClearsTetris(board0, piece1, piece2, e),
  );
}

/** A puzzle's recomputed difficulty under the 4-band + tetris-cap model (#71). */
export interface Reband extends Difficulty {
  /** True if an acceptable combo clears a tetris — the cap is in effect. */
  tetris: boolean;
  /** The (capped) difficulty band. */
  band: DifficultyBand;
  /** The (capped) seed rating. */
  seed: number;
}

/**
 * Recompute a stored puzzle's band + seed rating from its combo table under the
 * 4-band + tetris-cap model (#71) — the re-band migration's pure core. The
 * difficulty signals are taken from the stored `acceptCount`/`margin` (measured
 * over the full sweep at generation) when present, falling back to the top-K
 * scores; the tetris flag is detected by replaying the stored placements. No new
 * IDs, no StackRabbit — only the band/seed change.
 */
export function rebandPuzzle(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  entries: readonly ComboEntry[],
  stored?: { acceptCount?: number | null; margin?: number | null },
): Reband {
  const fromScores = difficultyFromScores(entries.map((e) => e.score));
  const acceptCount = stored?.acceptCount ?? fromScores.acceptCount;
  const margin = stored?.margin ?? fromScores.margin;
  const tetris = clearsTetrisFromEntries(board0, piece1, piece2, entries);
  const d: Difficulty = { acceptCount, margin };
  return { acceptCount, margin, tetris, band: bandFor(acceptCount, { tetris }), seed: seedRatingFor(d, { tetris }) };
}
