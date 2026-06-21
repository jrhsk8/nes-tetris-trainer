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

describe('buildReplay tuck animation (#43)', () => {
  /** A "translate(x%, y%)" string back into an integer (drow, dcol) board shift. */
  function displace(
    cells: ReadonlyArray<readonly [number, number]>,
    transform: string,
  ): Array<[number, number]> {
    const m = /translate\(([-0-9.]+)%,\s*([-0-9.]+)%\)/.exec(transform)!;
    const dcol = Math.round((Number(m[1]) * COLS) / 100);
    const drow = Math.round((Number(m[2]) * ROWS) / 100);
    return cells.map(([r, c]) => [r + drow, c + dcol] as [number, number]);
  }

  it('routes a tuck around the overhang — no overlay frame clips the stack', () => {
    // A ledge across cols 4..7 at row 10; the second piece is an I tucked into
    // the pocket beneath it (rotation 1, resting rows 16-19, col 4) — pinned by
    // its row so it is not re-dropped onto the ledge.
    const board = emptyBoard();
    for (let c = 4; c <= 7; c++) board[10][c] = 1;
    const line: Line = [
      { rotation: 0, col: 0 }, // O parked at the far column, out of the way
      { rotation: 1, col: 4, row: 16 }, // the tuck
    ];

    const frames = buildReplay(board, 'O', 'I', line);

    // The tuck must produce at least one sideways (under-the-overhang) move, not
    // a straight drop: some overlay frame is horizontally offset from the rest.
    const overlays = frames.filter((f) => f.overlay && f.overlay.piece === 'I');
    const offsets = overlays.map((f) => {
      const m = /translate\(([-0-9.]+)%,/.exec(f.overlay!.transform)!;
      return Math.round((Number(m[1]) * COLS) / 100);
    });
    expect(offsets.some((dx) => dx !== 0)).toBe(true);

    // No animation frame's overlay cells ever overlap a filled stack cell.
    for (const f of frames) {
      if (!f.overlay) continue;
      for (const [r, c] of displace(f.overlay.cells, f.overlay.transform)) {
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
          expect(f.grid[r][c]).toBe(0);
        }
      }
    }

    // It still settles to the tucked board in the final frame.
    const settledFrame = frames[frames.length - 1];
    for (const r of [16, 17, 18, 19]) expect(settledFrame.grid[r][4]).toBe(1);
  });
});
