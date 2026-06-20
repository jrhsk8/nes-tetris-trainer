import { describe, it, expect } from 'vitest';
import { gradeAttempt } from './index.js';
import type { Line } from './index.js';

const line = (
  first: [number, number],
  second: [number, number],
): Line => [
  { rotation: first[0], col: first[1] },
  { rotation: second[0], col: second[1] },
];

describe('checker — exact-match, solve-the-whole-line', () => {
  const optimal = line([0, 3], [2, 6]);

  it('solves the puzzle when both placements match exactly', () => {
    const result = gradeAttempt(optimal, line([0, 3], [2, 6]));
    expect(result).toEqual({ solved: true, firstCorrect: true, secondCorrect: true });
  });

  it('fails and does not grade the second move when the first is wrong', () => {
    // First move differs (col); even though the second matches the optimal,
    // it is not separately graded — a wrong first move ends the puzzle.
    const result = gradeAttempt(optimal, line([0, 4], [2, 6]));
    expect(result).toEqual({ solved: false, firstCorrect: false, secondCorrect: false });
  });

  it('treats a wrong rotation on the first move as a wrong first move', () => {
    const result = gradeAttempt(optimal, line([1, 3], [2, 6]));
    expect(result).toEqual({ solved: false, firstCorrect: false, secondCorrect: false });
  });

  it('grades the first correct but the second wrong as an unsolved attempt', () => {
    const result = gradeAttempt(optimal, line([0, 3], [2, 7]));
    expect(result).toEqual({ solved: false, firstCorrect: true, secondCorrect: false });
  });

  it('treats a wrong second rotation (same column) as a wrong second move', () => {
    const result = gradeAttempt(optimal, line([0, 3], [0, 6]));
    expect(result).toEqual({ solved: false, firstCorrect: true, secondCorrect: false });
  });
});
