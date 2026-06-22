import { describe, it, expect } from 'vitest';
import { gradeCombo, comboOutcomeKey, CORRECT_SCORE_THRESHOLD } from './combo.js';
import { emptyBoard } from './board.js';
import { applyRestingPlacement, boardKey } from './placement.js';
import type { ComboTable, Line } from './index.js';

const userLine = (
  first: [number, number],
  second: [number, number],
): Line => [
  { rotation: first[0], col: first[1] },
  { rotation: second[0], col: second[1] },
];

/** A combo table whose entries are the top-K, best-first. */
const table: ComboTable = {
  entries: [
    { rot1: 0, col1: 3, rot2: 2, col2: 6, score: 100 }, // rank 1
    { rot1: 0, col1: 3, rot2: 0, col2: 6, score: 97 }, // rank 2 (at the 97 boundary)
    { rot1: 1, col1: 0, rot2: 0, col2: 4, score: 80 }, // rank 3 (ranked but weak)
  ],
  total: 27,
};

describe('gradeCombo — combo-threshold grading (#34)', () => {
  it('grades the rank-1 combo correct with score 100 and rank 1', () => {
    const result = gradeCombo(table, userLine([0, 3], [2, 6]));
    expect(result).toEqual({ correct: true, score: 100, rank: 1, total: 27, ranked: true });
  });

  it('counts a combo at the >=97 boundary as correct (#60)', () => {
    const result = gradeCombo(table, userLine([0, 3], [0, 6]));
    expect(result.correct).toBe(true);
    expect(result.score).toBe(97);
    expect(result.rank).toBe(2);
    expect(result.ranked).toBe(true);
  });

  it('counts a ranked but sub-97 combo as incorrect, still reporting its rank (#60)', () => {
    const result = gradeCombo(table, userLine([1, 0], [0, 4]));
    expect(result).toEqual({ correct: false, score: 80, rank: 3, total: 27, ranked: true });
  });

  it('reports a combo beyond the stored top-K as "too low to rank"', () => {
    const result = gradeCombo(table, userLine([3, 9], [3, 9]));
    expect(result).toEqual({ correct: false, score: null, rank: null, total: 27, ranked: false });
  });

  it('exposes a correct-score threshold of 97 (#60)', () => {
    expect(CORRECT_SCORE_THRESHOLD).toBe(97);
  });

  it('does not short-circuit on a weak first placement — it grades the whole combo', () => {
    // A weak first move that nonetheless forms a stored, high-scoring combo is
    // graded on the combo's merit, not rejected up front.
    const weakFirstButGoodCombo: ComboTable = {
      entries: [{ rot1: 3, col1: 9, rot2: 0, col2: 0, score: 97 }],
      total: 5,
    };
    const result = gradeCombo(weakFirstButGoodCombo, userLine([3, 9], [0, 0]));
    expect(result.correct).toBe(true);
    expect(result.rank).toBe(1);
  });
});

describe('gradeCombo — outcome-by-resulting-board matching (#42)', () => {
  // S has two distinct orientations, so rotation indices 1 and 3 (3 mod 2 = 1)
  // land the SAME cells — exactly the app-vs-engine rotation-numbering mismatch
  // that tuple matching mis-grades and the board key fixes.
  const empty = emptyBoard();
  const stored: Line = [
    { rotation: 1, col: 0 },
    { rotation: 0, col: 4 },
  ];
  const storedKey = comboOutcomeKey(empty, 'S', 'O', stored);
  const v2Table: ComboTable = {
    entries: [{ rot1: 1, col1: 0, rot2: 0, col2: 4, score: 100, boardKey: storedKey }],
    total: 9,
  };

  it('matches an attempt by its resulting cells, not the placement tuple', () => {
    // The player encodes the S with rotation 3 (an alias of rotation 1): the
    // (rotation, col) tuple differs from the stored entry, but the cells — and
    // so the board key — are identical, so it grades as the rank-1 combo.
    const aliased: Line = [
      { rotation: 3, col: 0 },
      { rotation: 0, col: 4 },
    ];
    const key = comboOutcomeKey(empty, 'S', 'O', aliased);
    expect(key).toBe(storedKey);
    const result = gradeCombo(v2Table, aliased, key);
    expect(result).toEqual({ correct: true, score: 100, rank: 1, total: 9, ranked: true });
  });

  it('grades two encodings that land the same cells identically', () => {
    const byTuple = gradeCombo(v2Table, stored, comboOutcomeKey(empty, 'S', 'O', stored));
    const byAlias = gradeCombo(
      v2Table,
      [
        { rotation: 3, col: 0 },
        { rotation: 0, col: 4 },
      ],
      comboOutcomeKey(empty, 'S', 'O', [
        { rotation: 3, col: 0 },
        { rotation: 0, col: 4 },
      ]),
    );
    expect(byAlias).toEqual(byTuple);
  });

  it('does NOT match a v2 entry by a coincidental tuple when the cells differ', () => {
    // Same (rotation, col) tuple as the stored entry, but a different resulting
    // board (a different key): the board key is authoritative, so no match.
    const result = gradeCombo(v2Table, stored, 'a-different-resulting-board');
    expect(result).toEqual({ correct: false, score: null, rank: null, total: 9, ranked: false });
  });

  it('matches a tuck combo by its resulting-board key', () => {
    // A ledge across cols 4..7 at row 10; the optimal second piece is an I-piece
    // tucked UNDER it (rotation 1, row 16) — unreachable by a straight drop. The
    // combo is stored by where it rests, so a matching outcome key grades it.
    const ledge = emptyBoard();
    for (let c = 4; c <= 7; c++) ledge[10][c] = 1;
    const after1 = applyRestingPlacement(ledge, 'O', { rotation: 0, row: 18, col: 0 });
    const tucked = applyRestingPlacement(after1, 'I', { rotation: 1, row: 16, col: 4 });
    const tuckKey = boardKey(tucked);

    const tuckTable: ComboTable = {
      entries: [{ rot1: 0, col1: 0, rot2: 1, col2: 4, score: 100, boardKey: tuckKey }],
      total: 12,
    };
    const result = gradeCombo(tuckTable, userLine([0, 0], [1, 4]), tuckKey);
    expect(result).toEqual({ correct: true, score: 100, rank: 1, total: 12, ranked: true });
  });

  it('still matches legacy entries (no boardKey) by their placement tuple', () => {
    const legacy: ComboTable = {
      entries: [{ rot1: 0, col1: 3, rot2: 2, col2: 6, score: 100 }],
      total: 4,
    };
    expect(gradeCombo(legacy, userLine([0, 3], [2, 6])).rank).toBe(1);
  });
});

describe('comboOutcomeKey', () => {
  it('is the board key of the board after both placements are applied', () => {
    const empty = emptyBoard();
    const after1 = applyRestingPlacement(empty, 'O', { rotation: 0, row: 18, col: 0 });
    const after2 = applyRestingPlacement(after1, 'O', { rotation: 0, row: 18, col: 2 });
    const line: Line = [
      { rotation: 0, col: 0 },
      { rotation: 0, col: 2 },
    ];
    expect(comboOutcomeKey(empty, 'O', 'O', line)).toBe(boardKey(after2));
  });
});
