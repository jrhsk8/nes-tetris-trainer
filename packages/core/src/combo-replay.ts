/**
 * Combo replay utilities — reconstruct resting placements from stored combo
 * entries and detect line clears / tetrises. Pure: no engine, network, or DOM.
 *
 * Split from combo.ts (grading) because these concerns are independent: grading
 * is a score-threshold lookup; replay is geometry + state simulation.
 */

import {
  cloneBoard,
  clearFullRows,
  type Grid,
} from './board.js';
import type { Piece } from './pieces.js';
import {
  applyRestingPlacement,
  boardKey,
  enumerateResting,
  pieceCells,
  type RestingPlacement,
} from './placement.js';
import type { ComboEntry } from './combo.js';

/**
 * Reconstruct a stored combo entry's resting placements (with their rows) by
 * matching its `(rotation, col)` per piece against the reachable resting set,
 * disambiguated by the entry's outcome key when present.
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

/**
 * Lock a resting placement into `grid` WITHOUT clearing, count the rows THIS
 * placement completed, then clear and return the resulting board.
 */
export function lockAndClear(
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
 * True if the two-piece line clears a **tetris** — a single 4-row clear by
 * ONE of the two placements.
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

/** True if a single stored combo entry clears a tetris. */
export function entryClearsTetris(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  entry: ComboEntry,
): boolean {
  const line = restingLineForEntry(board0, piece1, piece2, entry);
  return line ? lineClearsTetris(board0, piece1, piece2, line.p1, line.p2) : false;
}
