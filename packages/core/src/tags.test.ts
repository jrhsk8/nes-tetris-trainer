import { describe, it, expect } from 'vitest';
import {
  emptyBoard,
  decodeBoard,
  fitsAt,
  applyRestingPlacement,
  boardKey,
  restingLineForEntry,
  tagPuzzle,
  type Grid,
  type Piece,
  type RestingPlacement,
  type ComboEntry,
} from './index.js';

/** Fill `cells` ([row,col]) of a fresh empty board. */
function board(cells: Array<[number, number]>): Grid {
  const g = emptyBoard();
  for (const [r, c] of cells) g[r][c] = 1;
  return g;
}

/** Fill every column in `cols` over the inclusive row range [r0,r1]. */
function fillRows(g: Grid, r0: number, r1: number, cols: number[]): Grid {
  for (let r = r0; r <= r1; r++) for (const c of cols) g[r][c] = 1;
  return g;
}

/** The straight-down hard-drop resting placement of a piece in a column. */
function hardDrop(g: Grid, piece: Piece, rotation: number, col: number): RestingPlacement {
  let row = 0;
  while (fitsAt(g, piece, rotation, row + 1, col)) row++;
  return { rotation, row, col };
}

/** Build a rank-1 combo entry pinning the two-piece outcome by its boardKey. */
function entryFor(
  start: Grid,
  piece1: Piece,
  p1: RestingPlacement,
  piece2: Piece,
  p2: RestingPlacement,
): ComboEntry {
  const b1 = applyRestingPlacement(start, piece1, p1);
  const b2 = applyRestingPlacement(b1, piece2, p2);
  return { rot1: p1.rotation, col1: p1.col, rot2: p2.rotation, col2: p2.col, score: 100, boardKey: boardKey(b2) };
}

describe('tagPuzzle (#81)', () => {
  it('clean-stacking: two flat O drops on an empty board, no clears, no holes', () => {
    const start = emptyBoard();
    const p1 = hardDrop(start, 'O', 0, 0);
    const b1 = applyRestingPlacement(start, 'O', p1);
    const p2 = hardDrop(b1, 'O', 0, 2);
    const entry = entryFor(start, 'O', p1, 'O', p2);
    expect(tagPuzzle(start, 'O', 'O', entry)).toEqual(['clean-stacking']);
  });

  it('tetris: a vertical I clears 4 in a depth-4 well', () => {
    const start = fillRows(emptyBoard(), 16, 19, [0, 1, 2, 3, 4, 5, 6, 7, 8]); // col 9 well
    const p1: RestingPlacement = { rotation: 1, row: 16, col: 9 };
    const b1 = applyRestingPlacement(start, 'I', p1);
    const p2 = hardDrop(b1, 'O', 0, 0);
    const entry = entryFor(start, 'I', p1, 'O', p2);
    const tags = tagPuzzle(start, 'I', 'O', entry);
    expect(tags).toContain('tetris');
    expect(tags).not.toContain('burn');
    // A board already tetris-ready at start is NOT tagged tetris-ready.
    expect(tags).not.toContain('tetris-ready');
  });

  it('burn + dig: clearing a row removes a covered hole (multi-tag)', () => {
    const start = emptyBoard();
    fillRows(start, 19, 19, [1, 2, 3, 4, 5, 6, 7, 8, 9]); // row 19 full except col 0 (the hole)
    fillRows(start, 18, 18, [0, 1, 2, 3, 4, 5, 6, 7]); // row 18 missing cols 8,9
    const p1 = hardDrop(start, 'O', 0, 8); // fills (18,8),(18,9) -> row 18 clears
    const b1 = applyRestingPlacement(start, 'O', p1);
    const p2 = hardDrop(b1, 'O', 0, 4);
    const entry = entryFor(start, 'O', p1, 'O', p2);
    const tags = tagPuzzle(start, 'O', 'O', entry);
    expect(tags).toContain('burn');
    expect(tags).toContain('dig');
    expect(tags).not.toContain('tetris');
    expect(tags).not.toContain('clean-stacking');
  });

  it('tetris-ready: an unready board becomes ready (vertical-I-clears-4)', () => {
    const start = emptyBoard();
    fillRows(start, 17, 19, [0, 1, 2, 3, 4, 5, 6, 7, 8]); // 3 full-in-0..8 rows over col-9 well
    fillRows(start, 16, 16, [0, 1, 2, 3, 4, 5, 6]); // row 16 missing cols 7,8 (and col 9 well)
    const p1 = hardDrop(start, 'O', 0, 7); // fills (16,7),(16,8) -> row 16 ready (col 9 still open)
    const b1 = applyRestingPlacement(start, 'O', p1);
    const p2 = hardDrop(b1, 'O', 0, 0);
    const entry = entryFor(start, 'O', p1, 'O', p2);
    const tags = tagPuzzle(start, 'O', 'O', entry);
    expect(tags).toContain('tetris-ready');
  });

  it('tuck: an I slid under an overhang into a deep pocket', () => {
    const start = board([
      [10, 4],
      [10, 5],
      [10, 6],
      [10, 7], // overhang ledge
    ]);
    const p1: RestingPlacement = { rotation: 1, row: 16, col: 4 }; // vertical I in the pocket
    // sanity: this is genuinely reachable + a tuck (restingLineForEntry finds it).
    const b1 = applyRestingPlacement(start, 'I', p1);
    const p2 = hardDrop(b1, 'O', 0, 0);
    const entry = entryFor(start, 'I', p1, 'O', p2);
    expect(restingLineForEntry(start, 'I', 'O', entry)).not.toBeNull();
    const tags = tagPuzzle(start, 'I', 'O', entry);
    expect(tags).toContain('tuck');
    expect(tags).not.toContain('spin');
  });

  it('spin: a T rotated at depth into a pocket (not translation-reachable)', () => {
    // A real bumpy board whose rank-1 first placement is a T resting at rot 3
    // (row 15, col 6) — reachable only by rotating at depth, never a straight
    // drop or a flat slide. The second placement is a plain hard-drop O.
    const start = decodeBoard(
      '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000100001000010000100001000010000100101000000010100001011000000101100010100110100011011110101110011010',
    );
    const p1: RestingPlacement = { rotation: 3, row: 15, col: 6 };
    const b1 = applyRestingPlacement(start, 'T', p1);
    const p2 = hardDrop(b1, 'O', 0, 7);
    const entry = entryFor(start, 'T', p1, 'O', p2);
    expect(restingLineForEntry(start, 'T', 'O', entry)).not.toBeNull();
    const tags = tagPuzzle(start, 'T', 'O', entry);
    expect(tags).toContain('spin');
    expect(tags).not.toContain('tuck');
  });

  it('well-maintenance: a single open well is kept open', () => {
    const start = fillRows(emptyBoard(), 17, 19, [0, 1, 2, 3, 4, 5, 6, 7, 8]); // col 9 well, depth 3
    const p1 = hardDrop(start, 'O', 0, 0);
    const b1 = applyRestingPlacement(start, 'O', p1);
    const p2 = hardDrop(b1, 'O', 0, 2);
    const entry = entryFor(start, 'O', p1, 'O', p2);
    const tags = tagPuzzle(start, 'O', 'O', entry);
    expect(tags).toContain('well-maintenance');
  });

  it('zero tags: a neutral stack that creates new holes matches nothing', () => {
    const start = emptyBoard();
    const p1 = hardDrop(start, 'S', 0, 0); // S leaves a covered hole
    const b1 = applyRestingPlacement(start, 'S', p1);
    const p2 = hardDrop(b1, 'S', 0, 4); // another, far away
    const entry = entryFor(start, 'S', p1, 'S', p2);
    expect(tagPuzzle(start, 'S', 'S', entry)).toEqual([]);
  });

  it('returns [] when the line cannot be reconstructed (legacy unrecoverable entry)', () => {
    const start = emptyBoard();
    // A (rotation, col) with no boardKey and no matching reachable resting line.
    const entry: ComboEntry = { rot1: 0, col1: 0, rot2: 0, col2: 0, score: 100, boardKey: 'x'.repeat(200) };
    expect(tagPuzzle(start, 'O', 'O', entry)).toEqual([]);
  });
});
