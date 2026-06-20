/**
 * Placement matching (#9) — convert the engine's result into our column-based
 * {@link Placement} without depending on StackRabbit's internal coordinate
 * system.
 *
 * StackRabbit reports a move as `[rotation, xOffset, yOffset]` in its own
 * spawn-relative coordinates, whose rotation numbering need not match ours.
 * Rather than reconcile those coordinates (the orientation risk flagged in the
 * PRD), we search OUR placement space for the (rotation, col) that reproduces
 * the engine's resulting board. The stored line is then in the exact format the
 * checker (#5) and the board renderer (#10) use — self-consistent by
 * construction.
 */

import {
  applyPlacement,
  ORIENTATIONS,
  COLS,
  type Grid,
  type Piece,
  type Placement,
} from '@trainer/core';

/** True if two grids have identical dimensions and cells. */
export function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false;
  for (let row = 0; row < a.length; row++) {
    if (a[row].length !== b[row].length) return false;
    for (let col = 0; col < a[row].length; col++) {
      if (a[row][col] !== b[row][col]) return false;
    }
  }
  return true;
}

/**
 * Find the (rotation, col) placement of `piece` on `before` that yields exactly
 * `after` (the engine's resulting board, line clears included). Returns `null`
 * if no single placement reproduces it — which signals the engine result is not
 * representable as one of our placements and the candidate should be rejected.
 */
export function toPlacement(before: Grid, piece: Piece, after: Grid): Placement | null {
  const rotations = ORIENTATIONS[piece].length;
  for (let rotation = 0; rotation < rotations; rotation++) {
    for (let col = 0; col < COLS; col++) {
      let result: Grid;
      try {
        result = applyPlacement(before, piece, { rotation, col });
      } catch {
        continue; // illegal placement at this (rotation, col)
      }
      if (gridsEqual(result, after)) return { rotation, col };
    }
  }
  return null;
}
