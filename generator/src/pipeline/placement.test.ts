import { describe, it, expect } from 'vitest';
import { applyPlacement, emptyBoard, ROWS, COLS, type Grid } from '@trainer/core';
import { toPlacement, gridsEqual } from './placement.js';

describe('gridsEqual', () => {
  it('is true for identical grids and false otherwise', () => {
    const a = emptyBoard();
    const b = emptyBoard();
    expect(gridsEqual(a, b)).toBe(true);
    b[0][0] = 1;
    expect(gridsEqual(a, b)).toBe(false);
  });
});

describe('toPlacement (recover our placement from the engine result)', () => {
  it('recovers the (rotation, col) that produced a result board', () => {
    const before = emptyBoard();
    const placement = { rotation: 0, col: 4 };
    const after = applyPlacement(before, 'T', placement);
    expect(toPlacement(before, 'T', after)).toEqual(placement);
  });

  it('recovers a placement even when it clears a line', () => {
    // Fill the bottom row except the two rightmost cells; an O at column 8
    // completes and clears that row.
    const before = emptyBoard();
    for (let col = 0; col < 8; col++) before[ROWS - 1][col] = 1;
    const placement = { rotation: 0, col: 8 };
    const after = applyPlacement(before, 'O', placement);
    expect(toPlacement(before, 'O', after)).toEqual(placement);
  });

  it('returns null when no single placement reproduces the board', () => {
    const before = emptyBoard();
    const bogus: Grid = emptyBoard();
    bogus[0][0] = 1; // a lone floating cell no dropped piece could create
    expect(toPlacement(before, 'T', bogus)).toBeNull();
  });

  it('distinguishes columns for the same rotation', () => {
    const before = emptyBoard();
    const after = applyPlacement(before, 'L', { rotation: 0, col: 2 });
    const recovered = toPlacement(before, 'L', after);
    expect(recovered).not.toBeNull();
    // Re-applying the recovered placement must reproduce the same board.
    expect(applyPlacement(before, 'L', recovered!)).toEqual(after);
    expect(recovered!.col).toBeLessThan(COLS);
  });
});
