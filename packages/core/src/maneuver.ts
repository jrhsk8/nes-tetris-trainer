/**
 * Maneuver classification — what KIND of move a resting placement is: a plain
 * **hard-drop**, a **tuck** (slid under an overhang), a **spin** (rotated into a
 * pocket at depth), or a **spintuck** (a tuck that only a last-second rotation can
 * seat at NES level-19 speed). A pure, engine-free classifier layered on the
 * geometry in `placement.ts` and the level-19 speed model in `nes-reachability.ts`.
 *
 * Split out of the type-tagger (`tags.ts`) so the classification — and the
 * translation-only reachability BFS it needs — lives in one module the tagger, the
 * play app, and the generator all consume, instead of being re-derived inside the
 * tagger. The reachability ENUMERATORS (`reachableStates`, `enumerateResting`,
 * `inputReachableRestingPlacements`) stay in `placement.ts`: they answer "which
 * placements are reachable?"; this module answers the dual question "given a
 * resting placement, how was it reached?".
 *
 * Pure: no engine, network, or DOM.
 */

import { COLS, type Grid } from './board.js';
import type { Piece } from './pieces.js';
import { fitsAt, type RestingPlacement } from './placement.js';
import { slideReachableAtSpeed, spinReachableAtSpeed } from './nes-reachability.js';

/**
 * The lowest row a piece reaches by a pure straight-down drop in `col` at the
 * fixed `rotation` (entering from the top), or `null` when it cannot even enter
 * the column from the top. A resting placement whose row exceeds this is reached
 * only by manoeuvring (a tuck or a spin), never a hard drop.
 */
function hardDropRow(
  grid: Grid,
  piece: Piece,
  rotation: number,
  col: number,
): number | null {
  if (!fitsAt(grid, piece, rotation, 0, col)) return null;
  let row = 0;
  while (fitsAt(grid, piece, rotation, row + 1, col)) row++;
  return row;
}

/** Is `placement` reachable by simply choosing a column + rotation and hard-dropping? */
function isHardDrop(grid: Grid, piece: Piece, placement: RestingPlacement): boolean {
  return hardDropRow(grid, piece, placement.rotation, placement.col) === placement.row;
}

function transKey(row: number, col: number): number {
  return row * COLS + col;
}

/**
 * Is `(rotation, targetRow, targetCol)` reachable by a **translation-only** BFS —
 * down / left / right with the orientation held fixed, entering from the top?
 * This is the tuck/spin splitter (#81): a non-hard-drop placement that is
 * translation-reachable is a **tuck** (slid under an overhang); one that is NOT
 * is a **spin** (it needs a rotation at depth).
 */
function translationReachable(
  grid: Grid,
  piece: Piece,
  rotation: number,
  targetRow: number,
  targetCol: number,
): boolean {
  const seen = new Set<number>();
  const queue: Array<[number, number]> = [];
  const visit = (r: number, c: number): void => {
    if (!fitsAt(grid, piece, rotation, r, c)) return;
    const k = transKey(r, c);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push([r, c]);
  };
  for (let c = 0; c < COLS; c++) visit(0, c); // enter from the top
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    visit(r + 1, c); // soft-drop
    visit(r, c - 1); // left
    visit(r, c + 1); // right
  }
  return seen.has(transKey(targetRow, targetCol));
}

/** Whether a resting placement is a tuck, a spin, or a plain hard drop. */
export function maneuver(
  grid: Grid,
  piece: Piece,
  placement: RestingPlacement,
): 'hard-drop' | 'tuck' | 'spin' {
  if (isHardDrop(grid, piece, placement)) return 'hard-drop';
  return translationReachable(grid, piece, placement.rotation, placement.row, placement.col)
    ? 'tuck'
    : 'spin';
}

/**
 * A **spintuck**: a placement you can only reach at NES level-19 speed by
 * rotating the piece into its cells **at the last second** — "the spin comes last
 * second". Formally:
 *
 *  1. It is an idealized `tuck` (the final cells sit under an overhang and are
 *     slide-reachable given unlimited time). This excludes pure `spin`s (a screw
 *     straight down a pocket with no lateral travel — that stays `spin`) and
 *     hard-drops.
 *  2. It is NOT {@link slideReachableAtSpeed}: at level 19, DAS-only, you cannot
 *     slide it under the lip in time pre-rotated (it needs more than the one
 *     under-cover shift you can land before it locks).
 *  3. It IS {@link spinReachableAtSpeed}: a last-second rotation at depth DOES
 *     seat it. This excludes placements that are simply impossible at speed —
 *     e.g. an O that would need a two-cell under-lip slide (an O cannot rotate, so
 *     no trick saves it; that is an unreachable tuck, not a spintuck).
 *
 * So a pre-rotated drop into a 1-deep notch is a plain tuck (slide-reachable at
 * speed); the owner's J — rotated to point down and seated under a row-above lip
 * into a 2-wide pocket — is a spintuck (the under-lip slide is too slow at 19, the
 * spin is not).
 */
export function isSpintuck(grid: Grid, piece: Piece, placement: RestingPlacement): boolean {
  if (maneuver(grid, piece, placement) !== 'tuck') return false;
  if (slideReachableAtSpeed(grid, piece, placement)) return false;
  return spinReachableAtSpeed(grid, piece, placement);
}
