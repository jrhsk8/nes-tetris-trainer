import { describe, it, expect } from 'vitest';
import {
  emptyBoard,
  decodeBoard,
  fitsAt,
  applyRestingPlacement,
  boardKey,
  restingLineForEntry,
  tagPuzzle,
  singlePieceDependencies,
  AVOID_DEPENDENCY_TAG,
  TRAP_BAND_MIN,
  TRAP_BAND_MAX,
  ROWS,
  COLS,
  type Grid,
  type Piece,
  type RestingPlacement,
  type ComboEntry,
  type ComboTable,
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

// --- #90 avoid-<piece>-dependency contrast tags ----------------------------

// Boards whose surface carries a single-piece dependency, discovered by the
// detector over random stacks (one distinct dependency piece each). The piece
// each forces is named in the constant.
const DEP_I =
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000010000001000001000101100101010111111101011101110100';
const DEP_S =
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000010001000001001110000100111100010011110000001001001011';
const DEP_Z =
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100000001110000000111000000011111100110011101011111111101111';
const DEP_J =
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000101100100110111010011111111';
const DEP_L =
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000011010010011101001001111100000111110010011011101000101110100';
// A trap alt board with TWO distinct dependencies (S at col 4, L at col 8).
const DEP_MULTI =
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000001010000010111000100111000011110100011011111101111011110';
// A flat board: zero single-piece dependencies (the clean rank-1 outcome).
const CLEAN =
  '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011111111111111111111';

describe('singlePieceDependencies (#90 detector)', () => {
  it('returns the forcing piece for each of I/S/Z/J/L', () => {
    const pieceOf = (s: string): Piece[] => [
      ...new Set(singlePieceDependencies(decodeBoard(s)).map((d) => d.piece)),
    ];
    expect(pieceOf(DEP_I)).toContain('I');
    expect(pieceOf(DEP_S)).toContain('S'); // depth-1 staircase
    expect(pieceOf(DEP_Z)).toContain('Z'); // mirror staircase
    expect(pieceOf(DEP_J)).toContain('J');
    expect(pieceOf(DEP_L)).toContain('L');
  });

  it('returns nothing for a flat board, a T-slot, and a tetris-ready well', () => {
    // flat
    const flat = decodeBoard(CLEAN);
    expect(singlePieceDependencies(flat)).toEqual([]);

    // T-slot: a centre-low 1-deep notch only a T (excluded) could fill.
    const tslot = emptyBoard();
    for (const c of [0, 1, 2, 3, 4, 6, 7, 8, 9]) {
      tslot[18][c] = 1;
      tslot[19][c] = 1;
    }
    tslot[19][5] = 1; // col 5 one shallower than both neighbours
    expect(singlePieceDependencies(tslot)).toEqual([]);

    // tetris-ready well: a depth-4 well whose vertical-I fill CLEARS — not a dep.
    const well = emptyBoard();
    for (let r = 16; r <= 19; r++) for (let c = 0; c <= 8; c++) well[r][c] = 1;
    expect(singlePieceDependencies(well)).toEqual([]);
  });

  it('ignores an edge depth-1 notch but keeps the same notch in the interior', () => {
    // DEP_J carries an interior J-notch at col 1. Sliding the whole stack one
    // column left moves that notch to col 0 (the edge), where it must vanish.
    const shiftLeft = (g: Grid): Grid => {
      const n = emptyBoard();
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS - 1; c++) n[r][c] = g[r][c + 1];
      return n;
    };
    const interior = singlePieceDependencies(decodeBoard(DEP_J));
    expect(interior.some((d) => d.col === 1 && d.piece === 'J')).toBe(true);

    const edge = singlePieceDependencies(shiftLeft(decodeBoard(DEP_J)));
    expect(edge.some((d) => d.col === 0)).toBe(false); // edge depth-1 ignored
  });

  it('O and T carry no dependency tag (single source of truth)', () => {
    expect(AVOID_DEPENDENCY_TAG.O).toBeNull();
    expect(AVOID_DEPENDENCY_TAG.T).toBeNull();
    expect(AVOID_DEPENDENCY_TAG.S).toBe('avoid-s-dependency');
  });
});

describe('tagPuzzle avoid-<piece>-dependency trap (#90)', () => {
  // A combo table whose rank-1 outcome is CLEAN and whose rank-2 alt outcome is
  // `altBoard`, scoring `altScore`. `board`/pieces are chosen so the rank-1 line
  // is unreconstructable (isolating the contrast tags), unless overridden.
  const trapTable = (altBoard: string, altScore: number, rank = 2): ComboTable => {
    const entries: ComboEntry[] = [
      { rot1: 0, col1: 0, rot2: 0, col2: 0, score: 100, boardKey: CLEAN },
    ];
    while (entries.length < rank - 1) {
      entries.push({ rot1: 0, col1: 1, rot2: 0, col2: 1, score: 98, boardKey: CLEAN });
    }
    entries.push({ rot1: 1, col1: 1, rot2: 1, col2: 1, score: altScore, boardKey: altBoard });
    return { entries, total: entries.length };
  };
  const avoidTags = (table: ComboTable): string[] =>
    tagPuzzle(emptyBoard(), 'O', 'O', table.entries[0], table).filter((t) =>
      t.startsWith('avoid-'),
    );

  it('emits the avoid tag when a rank-2 alt in [90,97) creates a dependency', () => {
    expect(avoidTags(trapTable(DEP_S, 95))).toEqual(['avoid-s-dependency']);
  });

  it('emits one tag PER distinct dependency piece a trap alt creates (multi-tag)', () => {
    const tags = avoidTags(trapTable(DEP_MULTI, 94));
    expect(tags).toContain('avoid-s-dependency');
    expect(tags).toContain('avoid-l-dependency');
  });

  it('respects the score band boundaries (96.9 qualifies, 97.0 does not)', () => {
    expect(avoidTags(trapTable(DEP_S, TRAP_BAND_MAX - 0.1))).toEqual(['avoid-s-dependency']);
    expect(avoidTags(trapTable(DEP_S, TRAP_BAND_MAX))).toEqual([]); // >= 97 graded right
    expect(avoidTags(trapTable(DEP_S, TRAP_BAND_MIN))).toEqual(['avoid-s-dependency']);
    expect(avoidTags(trapTable(DEP_S, TRAP_BAND_MIN - 0.1))).toEqual([]); // < 90 too low
  });

  it('only rank-2 / rank-3 alts spring the trap (rank 4 ignored)', () => {
    expect(avoidTags(trapTable(DEP_S, 95, 3))).toEqual(['avoid-s-dependency']);
    expect(avoidTags(trapTable(DEP_S, 95, 4))).toEqual([]); // beyond rank 3
  });

  it('no tag when the rank-1 outcome itself carries a dependency (not clean)', () => {
    const entries: ComboEntry[] = [
      { rot1: 0, col1: 0, rot2: 0, col2: 0, score: 100, boardKey: DEP_S }, // rank-1 not clean
      { rot1: 1, col1: 1, rot2: 1, col2: 1, score: 95, boardKey: DEP_L },
    ];
    expect(avoidTags({ entries, total: 2 })).toEqual([]);
  });

  it('does not regress the #81 rank-1 tags when a combo table is supplied', () => {
    // A reconstructable clean-stacking rank-1 (two flat O's) PLUS a trap alt.
    const start = emptyBoard();
    const p1 = hardDrop(start, 'O', 0, 0);
    const b1 = applyRestingPlacement(start, 'O', p1);
    const p2 = hardDrop(b1, 'O', 0, 2);
    const rank1 = entryFor(start, 'O', p1, 'O', p2);
    const table: ComboTable = {
      entries: [rank1, { rot1: 1, col1: 1, rot2: 1, col2: 1, score: 95, boardKey: DEP_S }],
      total: 2,
    };
    const tags = tagPuzzle(start, 'O', 'O', rank1, table);
    expect(tags).toContain('clean-stacking'); // #81 tag intact
    expect(tags).toContain('avoid-s-dependency'); // #90 tag added
  });
});
