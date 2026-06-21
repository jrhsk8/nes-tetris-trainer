import { describe, it, expect } from 'vitest';
import {
  COLS,
  ROWS,
  emptyBoard,
  emptyColorGrid,
  restingCells,
  type Grid,
  type Line,
} from '@trainer/core';
import { buildReplay } from './replay.js';

/** The settled (last) keyframe of a replay. */
function settled(board0: Grid, p1: 'T' | 'O' | 'I' | 'Z' | 'L' | 'J' | 'S', p2: typeof p1, line: Line, base = emptyColorGrid()) {
  const frames = buildReplay(board0, p1, p2, line, base);
  return frames[frames.length - 1];
}

describe('buildReplay colour tracking (#31)', () => {
  // Two independent columns so each piece rests on the original empty board.
  const line: Line = [
    { rotation: 0, col: 0 },
    { rotation: 0, col: 5 },
  ];

  it('paints each dropped piece with its own NES colour group in the settled frame', () => {
    const board0 = emptyBoard();
    const frame = settled(board0, 'Z', 'J', line); // Z → group 2, J → group 3
    expect(frame.colorGrid).toBeDefined();

    const zCells = restingCells(board0, 'Z', line[0])!;
    for (const [r, c] of zCells) expect(frame.colorGrid![r][c]).toBe(2);

    const jCells = restingCells(board0, 'J', line[1])!;
    for (const [r, c] of jCells) expect(frame.colorGrid![r][c]).toBe(3);
  });

  it('preserves the pre-existing stack colours (never reverts to white/0)', () => {
    const board0 = emptyBoard();
    board0[ROWS - 1][5] = 1; // a lone filled cell, far from the drops
    const base = emptyColorGrid();
    base[ROWS - 1][5] = 2; // coloured group 2

    const frame = settled(board0, 'I', 'O', line, base);
    expect(frame.colorGrid![ROWS - 1][5]).toBe(2);
  });

  it('tracks colours through a line-clear collapse (colour grid matches the binary grid)', () => {
    const board0 = emptyBoard();
    for (let c = 0; c < 8; c++) {
      board0[ROWS - 1][c] = 1;
      board0[ROWS - 2][c] = 1;
    }
    const clearLine: Line = [
      { rotation: 0, col: 8 }, // O completes the bottom two rows at cols 8-9
      { rotation: 0, col: 0 },
    ];
    const frame = settled(board0, 'O', 'O', clearLine);

    // Every filled binary cell has a non-zero colour; every empty cell is 0.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (frame.grid[r][c]) expect(frame.colorGrid![r][c]).toBeGreaterThan(0);
        else expect(frame.colorGrid![r][c]).toBe(0);
      }
    }
  });

  it('omits colour grids when no base is supplied (white-fallback compatibility)', () => {
    const frame = buildReplay(emptyBoard(), 'T', 'L', line).slice(-1)[0];
    expect(frame.colorGrid).toBeUndefined();
  });
});
