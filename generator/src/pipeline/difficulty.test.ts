import { describe, it, expect } from 'vitest';
import {
  difficultyFromScores,
  seedRatingFor,
  bandFor,
  EASY_SEED,
  HARD_SEED,
  HARD_MAX_ACCEPTS,
  EASY_MIN_ACCEPTS,
} from './difficulty.js';

describe('difficultyFromScores (#40)', () => {
  it('counts accepts (≥97) and the margin below the accept bar (#60)', () => {
    // One acceptable answer (100), the rest far below → small accept count, big margin.
    const d = difficultyFromScores([100, 40, 30, 0]);
    expect(d.acceptCount).toBe(1);
    expect(d.margin).toBe(60); // 100 - best-below-97 (40)
  });

  it('reports the accept count and margin against the 97 bar (#60)', () => {
    const d = difficultyFromScores([100, 99, 97, 96, 95, 80]);
    expect(d.acceptCount).toBe(3); // 100, 99, 97 clear the 97 bar
    expect(d.margin).toBe(4); // 100 - best-below-97 (96)
  });

  it('has margin 0 when every combo passes the bar (no separation)', () => {
    const d = difficultyFromScores([100, 98, 97]);
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

describe('bandFor (difficulty bands by answer-set tightness, #52)', () => {
  it('buckets by acceptCount at the band boundaries', () => {
    expect(bandFor(1)).toBe('hard');
    expect(bandFor(HARD_MAX_ACCEPTS)).toBe('hard'); // 2 → hard
    expect(bandFor(HARD_MAX_ACCEPTS + 1)).toBe('medium'); // 3 → medium
    expect(bandFor(EASY_MIN_ACCEPTS - 1)).toBe('medium'); // 7 → medium
    expect(bandFor(EASY_MIN_ACCEPTS)).toBe('easy'); // 8 → easy
    expect(bandFor(50)).toBe('easy');
  });

  it('guarantees every hard puzzle has a genuinely tight answer set (≤ 2)', () => {
    for (let n = 1; n <= 30; n++) {
      if (bandFor(n) === 'hard') expect(n).toBeLessThanOrEqual(HARD_MAX_ACCEPTS);
    }
  });

  it('seed rating tracks the band (hard > medium > easy)', () => {
    const hard = seedRatingFor({ acceptCount: 1, margin: 30 });
    const medium = seedRatingFor({ acceptCount: 5, margin: 30 });
    const easy = seedRatingFor({ acceptCount: 12, margin: 30 });
    expect(bandFor(1)).toBe('hard');
    expect(bandFor(5)).toBe('medium');
    expect(bandFor(12)).toBe('easy');
    expect(hard).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(easy);
  });
});
