import { describe, it, expect } from 'vitest';
import {
  ROWS,
  COLS,
  emptyBoard,
  encodeBoard,
  decodeBoard,
  applyPlacement,
  restingCells,
  clearFullRows,
  columnHeights,
  emptyColorGrid,
  encodeColors,
  decodeColors,
  applyPlacementColored,
} from './index.js';

describe('board encoding', () => {
  it('decodes a 200-char string row-major from the top', () => {
    // A single filled cell at the very first character is the top-left corner.
    const str = '1' + '0'.repeat(ROWS * COLS - 1);
    const grid = decodeBoard(str);
    expect(grid[0][0]).toBe(1);
    expect(grid[0][1]).toBe(0);
    expect(grid[19][9]).toBe(0);

    // The very last character is the bottom-right corner (floor, right wall).
    const floor = '0'.repeat(ROWS * COLS - 1) + '1';
    expect(decodeBoard(floor)[19][9]).toBe(1);
  });

  it('treats any non-zero character as filled', () => {
    const grid = decodeBoard('X' + '0'.repeat(ROWS * COLS - 1));
    expect(grid[0][0]).toBe(1);
  });

  it('round-trips encode ∘ decode for a binary board', () => {
    const grid = emptyBoard();
    grid[19][0] = 1;
    grid[18][0] = 1;
    grid[19][9] = 1;
    grid[0][4] = 1;
    expect(decodeBoard(encodeBoard(grid))).toEqual(grid);
  });

  it('rejects strings of the wrong length', () => {
    expect(() => decodeBoard('0'.repeat(199))).toThrow();
  });
});

describe('applyPlacement', () => {
  it('drops a piece to the floor of an empty board', () => {
    // O at col 0 rests on the floor, occupying the bottom-left 2×2.
    const out = applyPlacement(emptyBoard(), 'O', { rotation: 0, col: 0 });
    expect(out[18][0]).toBe(1);
    expect(out[18][1]).toBe(1);
    expect(out[19][0]).toBe(1);
    expect(out[19][1]).toBe(1);
    expect(columnHeights(out).slice(0, 2)).toEqual([2, 2]);
  });

  it('drops a vertical I to the floor at the chosen column', () => {
    const out = applyPlacement(emptyBoard(), 'I', { rotation: 1, col: 5 });
    expect(columnHeights(out)[5]).toBe(4);
    expect(out[16][5]).toBe(1);
    expect(out[19][5]).toBe(1);
  });

  it('rests a piece on top of the existing stack instead of overlapping', () => {
    const board = emptyBoard();
    board[19][0] = 1; // a one-cell tower in column 0
    const out = applyPlacement(board, 'O', { rotation: 0, col: 0 });
    // O cannot enter the occupied floor cell, so it stacks above it.
    expect(out[17][0]).toBe(1);
    expect(out[18][0]).toBe(1);
    expect(out[19][0]).toBe(1); // untouched original
  });

  it('does not mutate the input grid', () => {
    const board = emptyBoard();
    applyPlacement(board, 'O', { rotation: 0, col: 0 });
    expect(board.every((row) => row.every((cell) => cell === 0))).toBe(true);
  });

  it('clears a completed row after locking the piece', () => {
    const board = emptyBoard();
    for (let col = 0; col < COLS - 1; col++) board[19][col] = 1; // floor full except col 9
    const out = applyPlacement(board, 'I', { rotation: 1, col: 9 });
    // The I completes row 19 (clears it); its top three cells fall by one row.
    expect(columnHeights(out)[9]).toBe(3);
    expect(out[19][9]).toBe(1);
    expect(out[19][0]).toBe(0); // the cleared floor is gone
  });

  it('throws when the placement runs off the edge', () => {
    expect(() => applyPlacement(emptyBoard(), 'I', { rotation: 0, col: 8 })).toThrow();
  });
});

describe('restingCells', () => {
  it('returns the cells a piece rests on, on the floor of an empty board', () => {
    const cells = restingCells(emptyBoard(), 'O', { rotation: 0, col: 0 });
    expect(cells).not.toBeNull();
    // An O on an empty board rests on the floor (rows 18-19), columns 0-1.
    expect(new Set(cells!.map(([r, c]) => `${r},${c}`))).toEqual(
      new Set(['18,0', '18,1', '19,0', '19,1']),
    );
  });

  it('rests on top of the existing stack', () => {
    const board = emptyBoard();
    board[19][0] = 1; // a block on the floor in column 0
    const cells = restingCells(board, 'O', { rotation: 0, col: 0 });
    // The O cannot enter column 0's floor, so it rests one row higher (rows 17-18).
    expect(cells!.every(([r]) => r === 17 || r === 18)).toBe(true);
  });

  it('returns null for an illegal placement (off the edge), matching applyPlacement', () => {
    expect(restingCells(emptyBoard(), 'I', { rotation: 0, col: 8 })).toBeNull();
    expect(() => applyPlacement(emptyBoard(), 'I', { rotation: 0, col: 8 })).toThrow();
  });

  it('agrees with applyPlacement: locking the resting cells yields the same board', () => {
    const board = emptyBoard();
    board[19][5] = 1;
    const placement = { rotation: 0, col: 3 };
    const cells = restingCells(board, 'T', placement)!;
    const manual = board.map((row) => row.slice());
    for (const [r, c] of cells) manual[r][c] = 1;
    expect(manual).toEqual(applyPlacement(board, 'T', placement));
  });
});

describe('clearFullRows', () => {
  it('removes full rows and shifts the stack down', () => {
    const board = emptyBoard();
    for (let col = 0; col < COLS; col++) board[19][col] = 1; // full floor
    board[18][0] = 1; // a block resting on the floor
    const out = clearFullRows(board);
    expect(out[19][0]).toBe(1); // shifted down into the cleared row
    expect(out[19][1]).toBe(0);
    expect(out.flat().reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('colour grid', () => {
  it('round-trips through encode/decode', () => {
    const grid = emptyColorGrid();
    grid[19][0] = 1;
    grid[19][1] = 2;
    grid[18][9] = 3;
    const encoded = encodeColors(grid);
    expect(encoded).toHaveLength(ROWS * COLS);
    expect(decodeColors(encoded)).toEqual(grid);
  });

  it('fills locked cells with the piece colour group', () => {
    const { board, colors } = applyPlacementColored(
      emptyBoard(),
      emptyColorGrid(),
      'O', // group 1
      { rotation: 0, col: 0 },
      1,
    );
    // O rests on the floor occupying rows 18-19, cols 0-1.
    for (const [r, c] of [
      [18, 0],
      [18, 1],
      [19, 0],
      [19, 1],
    ] as const) {
      expect(board[r][c]).toBe(1);
      expect(colors[r][c]).toBe(1);
    }
    expect(colors[17][0]).toBe(0);
  });

  it('propagates colours through a line clear, in lock-step with the binary grid', () => {
    const board = emptyBoard();
    const colors = emptyColorGrid();
    // Bottom row filled (group 2) except the rightmost column.
    for (let col = 0; col < COLS - 1; col++) {
      board[19][col] = 1;
      colors[19][col] = 2;
    }
    // A lone block (group 3) one row up, in the leftmost column.
    board[18][0] = 1;
    colors[18][0] = 3;

    // A vertical I (group 1) dropped into the last column completes row 19.
    const placement = { rotation: 1, col: COLS - 1 };
    const result = applyPlacementColored(board, colors, 'I', placement, 1);

    // The binary board matches the colour-blind applyPlacement exactly.
    expect(result.board).toEqual(applyPlacement(board, 'I', placement));

    // Row 19 cleared; the group-3 block and the I's surviving cells dropped down.
    expect(result.colors[19][0]).toBe(3); // lone block shifted to the floor
    expect(result.colors[19][COLS - 1]).toBe(1); // bottom of the I
    expect(result.colors[18][COLS - 1]).toBe(1);
    expect(result.colors[17][COLS - 1]).toBe(1);
    // The cleared group-2 row is gone.
    expect(result.colors[19][1]).toBe(0);
  });
});
