import { describe, it, expect } from 'vitest';
import { ROWS, COLS, emptyBoard, type Grid } from '@trainer/core';
import { passesGeometricPrefilter } from './filters.js';

/** A board with `n` covered holes in column 0 (a filled cell over an empty one). */
function boardWithHoles(n: number): Grid {
  const board = emptyBoard();
  for (let i = 0; i < n; i++) {
    const row = ROWS - 1 - i * 2;
    board[row - 1][0] = 1; // filled cell...
    board[row][0] = 0; // ...over an empty one (a hole)
  }
  return board;
}

describe('passesGeometricPrefilter (#33)', () => {
  it('keeps a clean, flat board', () => {
    expect(passesGeometricPrefilter(emptyBoard(), 4, 32)).toBe(true);
  });

  it('rejects a board with more holes than allowed', () => {
    const board = boardWithHoles(6);
    expect(passesGeometricPrefilter(board, 4, 1000)).toBe(false);
  });

  it('keeps a board within the hole allowance', () => {
    const board = boardWithHoles(2);
    expect(passesGeometricPrefilter(board, 4, 1000)).toBe(true);
  });

  it('rejects an excessively bumpy board', () => {
    // A single very tall column against an empty neighbour → high bumpiness.
    const board = emptyBoard();
    for (let r = 0; r < ROWS; r++) board[r][0] = 1;
    expect(passesGeometricPrefilter(board, 1000, 5)).toBe(false);
  });

  it('keeps a gently uneven board', () => {
    const board = emptyBoard();
    for (let c = 0; c < COLS; c++) board[ROWS - 1][c] = 1; // one flat row
    expect(passesGeometricPrefilter(board, 4, 32)).toBe(true);
  });
});
