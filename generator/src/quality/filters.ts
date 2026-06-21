/**
 * Quality filters (#7, retargeted by #33) — pure gates over a candidate board.
 *
 * The combo-grading overhaul (#33) dropped the unambiguity / discrimination
 * gate (combo-threshold grading needs no unique best) and moved Hz-invariance to
 * the *best combo* (it now lives in the combo sweep, see {@link
 * ./../pipeline/combo}). What remains pure and engine-free is the cheap
 * geometric pre-filter that drops obvious garbage before any engine call.
 */

import { boardMetrics, type Grid } from '@trainer/core';

/**
 * Cheap geometric pre-filter (#33): keep a candidate only if its board is not
 * obvious garbage — at most `maxHoles` holes and bumpiness at most
 * `maxBumpiness`. Runs before the engine-driven board-health floor and the combo
 * sweep, so the expensive engine work is spent only on plausibly-clean boards.
 */
export function passesGeometricPrefilter(
  board: Grid,
  maxHoles: number,
  maxBumpiness: number,
): boolean {
  const metrics = boardMetrics(board);
  return metrics.holes <= maxHoles && metrics.bumpiness <= maxBumpiness;
}
