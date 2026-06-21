import { describe, it, expect } from 'vitest';
import {
  emptyBoard,
  encodeBoard,
  applyPlacement,
  pieceCells,
  fitsAt,
  isResting,
  applyRestingPlacement,
  enumerateResting,
  boardKey,
  type RestingPlacement,
} from './index.js';

describe('pieceCells / fitsAt / isResting', () => {
  it('places a piece at a board offset (bounding-box top-left at row,col)', () => {
    // Vertical I (rotation 1) at row 16, col 4 occupies rows 16..19 of column 4.
    expect(pieceCells('I', 1, 16, 4)).toEqual([
      [16, 4],
      [17, 4],
      [18, 4],
      [19, 4],
    ]);
  });

  it('fitsAt rejects out-of-bounds and occupied cells', () => {
    const grid = emptyBoard();
    grid[19][4] = 1;
    expect(fitsAt(grid, 'I', 1, 16, 4)).toBe(false); // overlaps the filled floor cell
    expect(fitsAt(grid, 'I', 1, 17, 9)).toBe(false); // rows 17..20 — row 20 off board
    expect(fitsAt(grid, 'O', 0, 18, 0)).toBe(true);
  });

  it('isResting is true only when the piece cannot move down', () => {
    const grid = emptyBoard();
    expect(isResting(grid, 'O', 0, 18, 0)).toBe(true); // on the floor
    expect(isResting(grid, 'O', 0, 0, 0)).toBe(false); // floating
  });
});

describe('applyRestingPlacement', () => {
  it('matches applyPlacement for a plain hard drop (acceptance c)', () => {
    const grid = emptyBoard();
    // O hard-dropped at col 3 rests on the floor: bounding-box top at row 18.
    const viaResting = applyRestingPlacement(grid, 'O', { rotation: 0, row: 18, col: 3 });
    const viaHardDrop = applyPlacement(grid, 'O', { rotation: 0, col: 3 });
    expect(viaResting).toEqual(viaHardDrop);
  });

  it('clears full rows after locking', () => {
    const grid = emptyBoard();
    for (let c = 0; c < 8; c++) grid[19][c] = 1; // row 19 filled except cols 8,9
    // Vertical I would not fill the row; use O across cols 8,9 to complete row 19.
    const out = applyRestingPlacement(grid, 'O', { rotation: 0, row: 18, col: 8 });
    // Row 19 was completed and cleared, leaving only the O's upper half at row 19.
    expect(out[19][8]).toBe(1);
    expect(out[19][9]).toBe(1);
    expect(out[18][8]).toBe(0);
  });

  it('throws on an illegal (overlapping) placement', () => {
    const grid = emptyBoard();
    grid[19][0] = 1;
    expect(() => applyRestingPlacement(grid, 'O', { rotation: 0, row: 18, col: 0 })).toThrow();
  });
});

describe('enumerateResting', () => {
  it('enumerates every hard-drop column on an empty board (acceptance c)', () => {
    const places = enumerateResting(emptyBoard(), 'O');
    // O is 2 wide, so cols 0..8, each resting with bbox-top at row 18.
    for (let col = 0; col <= 8; col++) {
      expect(places).toContainEqual<RestingPlacement>({ rotation: 0, row: 18, col });
    }
    // Every enumerated placement actually rests and is unique.
    for (const p of places) expect(isResting(emptyBoard(), 'O', p.rotation, p.row, p.col)).toBe(true);
  });

  it('enumerates a tuck resting placement under an overhang (acceptance a)', () => {
    // A ledge across cols 4..7 at row 10. Below it (rows 11..19) is open, but a
    // piece dropped straight down those columns lands ON the ledge — the space
    // beneath is reachable only by dropping down open col 3 and sliding right.
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;

    const tuck: RestingPlacement = { rotation: 1, row: 16, col: 4 };
    const places = enumerateResting(grid, 'I');

    // The tuck is enumerated...
    expect(places).toContainEqual(tuck);
    // ...it genuinely rests there...
    expect(isResting(grid, 'I', tuck.rotation, tuck.row, tuck.col)).toBe(true);
    // ...and it is NOT a hard drop: dropping straight down col 4 rests on the ledge.
    const hardDrop = places.find((p) => p.rotation === 1 && p.col === 4 && p.row < 10);
    expect(hardDrop).toBeDefined();
    expect(hardDrop!.row).toBe(6); // bottom at row 9, on top of the ledge
  });

  it('every enumerated placement is a superset of hard drops (binding invariant)', () => {
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;
    const places = enumerateResting(grid, 'I');
    // Both the on-ledge hard drop and the under-ledge tuck for col 4 are present.
    expect(places.some((p) => p.rotation === 1 && p.col === 4 && p.row === 6)).toBe(true);
    expect(places.some((p) => p.rotation === 1 && p.col === 4 && p.row === 16)).toBe(true);
  });
});

describe('boardKey (canonical outcome key)', () => {
  it('two encodings landing the same cells produce the same key (acceptance b)', () => {
    const viaPlacement = applyRestingPlacement(emptyBoard(), 'O', { rotation: 0, row: 18, col: 0 });

    const manual = emptyBoard();
    manual[18][0] = manual[18][1] = manual[19][0] = manual[19][1] = 1;

    expect(boardKey(viaPlacement)).toBe(boardKey(manual));
    expect(boardKey(viaPlacement)).toBe(encodeBoard(viaPlacement));
  });

  it('a tuck placement and a directly-built identical board share a key', () => {
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;
    const tucked = applyRestingPlacement(grid, 'I', { rotation: 1, row: 16, col: 4 });

    const manual = emptyBoard();
    for (let c = 4; c <= 7; c++) manual[10][c] = 1;
    for (let r = 16; r <= 19; r++) manual[r][4] = 1;

    expect(boardKey(tucked)).toBe(boardKey(manual));
  });
});
