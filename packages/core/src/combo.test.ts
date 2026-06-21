import { describe, it, expect } from 'vitest';
import { gradeCombo, CORRECT_SCORE_THRESHOLD } from './combo.js';
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
    { rot1: 0, col1: 3, rot2: 0, col2: 6, score: 95 }, // rank 2 (at the boundary)
    { rot1: 1, col1: 0, rot2: 0, col2: 4, score: 80 }, // rank 3 (ranked but weak)
  ],
  total: 27,
};

describe('gradeCombo — combo-threshold grading (#34)', () => {
  it('grades the rank-1 combo correct with score 100 and rank 1', () => {
    const result = gradeCombo(table, userLine([0, 3], [2, 6]));
    expect(result).toEqual({ correct: true, score: 100, rank: 1, total: 27, ranked: true });
  });

  it('counts a combo at the >=95 boundary as correct', () => {
    const result = gradeCombo(table, userLine([0, 3], [0, 6]));
    expect(result.correct).toBe(true);
    expect(result.score).toBe(95);
    expect(result.rank).toBe(2);
    expect(result.ranked).toBe(true);
  });

  it('counts a ranked but sub-95 combo as incorrect, still reporting its rank', () => {
    const result = gradeCombo(table, userLine([1, 0], [0, 4]));
    expect(result).toEqual({ correct: false, score: 80, rank: 3, total: 27, ranked: true });
  });

  it('reports a combo beyond the stored top-K as "too low to rank"', () => {
    const result = gradeCombo(table, userLine([3, 9], [3, 9]));
    expect(result).toEqual({ correct: false, score: null, rank: null, total: 27, ranked: false });
  });

  it('exposes a correct-score threshold of 95', () => {
    expect(CORRECT_SCORE_THRESHOLD).toBe(95);
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
