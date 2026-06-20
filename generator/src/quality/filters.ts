/**
 * Quality filters (#7) — the two pure gates that decide which self-play
 * candidates become puzzles (docs/PRD-v1.md, "Generation" and "Hz-invariance").
 * These are pure predicates over engine outputs; they hold no engine or network
 * dependency and are composed by the generation CLI (#9).
 *
 *  - Unambiguity (fairness) gate: the best line must beat the second-best by a
 *    large `totalValue` margin, applied to BOTH plies. This is what makes
 *    exact-match grading fair — it is NOT a difficulty signal.
 *  - Hz-invariance gate: the optimal move must be identical at the slow-tap and
 *    fast-DAS input timelines, so no puzzle's answer depends on execution speed.
 */

/** The minimal shape needed to compare two resting placements for identity. */
export interface ComparableMove {
  /** Rotation index (StackRabbit's numbering). */
  rotation: number;
  /** Horizontal offset of the piece origin from the spawn column. */
  x: number;
}

/**
 * A starting default for the unambiguity margin, in engine `totalValue` units.
 * It is a tunable parameter, not a fixed rule — the generation CLI (#9) passes
 * an explicit threshold and calibrates it against a sample bank before scaling.
 */
export const DEFAULT_UNAMBIGUITY_THRESHOLD = 5;

/** True if two placements rest in the same rotation at the same column. */
export function movesEqual(a: ComparableMove, b: ComparableMove): boolean {
  return a.rotation === b.rotation && a.x === b.x;
}

/**
 * Unambiguity gate for a single ply: true when the best move beats the
 * second-best by at least `threshold` in `totalValue`. A margin exactly equal
 * to the threshold counts as unambiguous. A non-finite value (e.g. the engine
 * failed to score a move) is never unambiguous.
 *
 * Apply this to BOTH plies of a candidate line; the line is fair only if every
 * ply clears the gate.
 */
export function isUnambiguous(
  bestValue: number,
  secondBestValue: number,
  threshold: number,
): boolean {
  if (!Number.isFinite(bestValue) || !Number.isFinite(secondBestValue)) return false;
  return bestValue - secondBestValue >= threshold;
}

/**
 * Hz-invariance gate: true when the optimal move is identical across every
 * supplied input timeline (e.g. slow-tap and fast-DAS). `movesAcrossTimelines`
 * is the optimal move evaluated once per timeline; the candidate survives only
 * if they all agree on rotation + column. An empty list is not invariant (there
 * is nothing to confirm).
 */
export function isHzInvariant(movesAcrossTimelines: readonly ComparableMove[]): boolean {
  if (movesAcrossTimelines.length === 0) return false;
  const [first, ...rest] = movesAcrossTimelines;
  return rest.every((move) => movesEqual(first, move));
}
