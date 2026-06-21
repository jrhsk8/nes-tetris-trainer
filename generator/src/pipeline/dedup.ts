/**
 * Near-duplicate rejection (#40, v2 overhaul issue D).
 *
 * Reject a candidate whose `(piece1, piece2)` match AND whose starting board is
 * within a small Hamming distance of any puzzle already accepted — checked
 * against the in-progress batch and (optionally) the existing bank
 * (docs/decisions.md 2026-06-21). This catches near-identical look-alikes, not
 * just byte-identical duplicates. Pure: operates on the binary grid only.
 */

import { ROWS, COLS, type Grid, type Piece } from '@trainer/core';

/** A puzzle's dedup identity: its two pieces and its starting board. */
export interface BankKey {
  piece1: Piece;
  piece2: Piece;
  board: Grid;
}

/** The number of cells that differ between two same-sized boards. */
export function boardHamming(a: Grid, b: Grid): number {
  let diff = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((a[row][col] ? 1 : 0) !== (b[row][col] ? 1 : 0)) diff++;
    }
  }
  return diff;
}

/**
 * True if `key` is a near-duplicate of any entry in `existing`: same piece pair
 * AND board within `maxHamming` differing cells.
 */
export function isNearDuplicate(
  key: BankKey,
  existing: Iterable<BankKey>,
  maxHamming: number,
): boolean {
  for (const other of existing) {
    if (other.piece1 !== key.piece1 || other.piece2 !== key.piece2) continue;
    if (boardHamming(other.board, key.board) <= maxHamming) return true;
  }
  return false;
}
