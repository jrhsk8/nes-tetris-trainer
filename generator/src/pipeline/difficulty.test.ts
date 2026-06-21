import { describe, it, expect } from 'vitest';
import { difficultyFromScores, seedRatingFor, EASY_SEED, HARD_SEED } from './difficulty.js';

describe('difficultyFromScores (#40)', () => {
  it('counts accepts (≥95) and the margin below the accept bar', () => {
    // One acceptable answer (100), the rest far below → small accept count, big margin.
    const d = difficultyFromScores([100, 40, 30, 0]);
    expect(d.acceptCount).toBe(1);
    expect(d.margin).toBe(60); // 100 - best-below-95 (40)
  });

  it('reports a tiny margin when many answers pass', () => {
    const d = difficultyFromScores([100, 99, 97, 96, 95, 80]);
    expect(d.acceptCount).toBe(5);
    expect(d.margin).toBe(20); // 100 - 80
  });

  it('has margin 0 when every combo passes the bar (no separation)', () => {
    const d = difficultyFromScores([100, 98, 96]);
    expect(d.acceptCount).toBe(3);
    expect(d.margin).toBe(0);
  });
});

describe('seedRatingFor (#40)', () => {
  it('maps harder puzzles to a higher seed, within [EASY_SEED, HARD_SEED]', () => {
    const hard = seedRatingFor({ acceptCount: 1, margin: 60 });
    const easy = seedRatingFor({ acceptCount: 12, margin: 0 });
    expect(hard).toBeGreaterThan(easy);
    expect(easy).toBe(EASY_SEED);
    expect(hard).toBe(HARD_SEED);
  });

  it('keeps every seed within the bounds for any signal', () => {
    for (const acceptCount of [1, 2, 5, 20]) {
      for (const margin of [0, 10, 50, 100]) {
        const r = seedRatingFor({ acceptCount, margin });
        expect(r).toBeGreaterThanOrEqual(EASY_SEED);
        expect(r).toBeLessThanOrEqual(HARD_SEED);
      }
    }
  });
});
