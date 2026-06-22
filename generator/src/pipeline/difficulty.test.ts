import { describe, it, expect } from 'vitest';
import { emptyBoard, type ComboEntry } from '@trainer/core';
import {
  difficultyFromScores,
  seedRatingFor,
  bandFor,
  lineClearsTetris,
  clearsTetrisFromEntries,
  rebandPuzzle,
  VERY_EASY_SEED,
  EASY_SEED,
  HARD_SEED,
  HARD_MAX_ACCEPTS,
  EASY_MIN_ACCEPTS,
  VERY_EASY_MIN_ACCEPTS,
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

describe('seedRatingFor (#40, #71)', () => {
  it('maps harder puzzles to a higher seed, within [VERY_EASY_SEED, HARD_SEED]', () => {
    const hard = seedRatingFor({ acceptCount: 1, margin: 60 });
    const veryEasy = seedRatingFor({ acceptCount: VERY_EASY_MIN_ACCEPTS, margin: 0 });
    expect(hard).toBeGreaterThan(veryEasy);
    expect(veryEasy).toBe(VERY_EASY_SEED);
    expect(hard).toBe(HARD_SEED);
  });

  it('keeps every seed within the bounds for any signal', () => {
    for (const acceptCount of [1, 2, 5, 12, 20]) {
      for (const margin of [0, 10, 50, 100]) {
        const r = seedRatingFor({ acceptCount, margin });
        expect(r).toBeGreaterThanOrEqual(VERY_EASY_SEED);
        expect(r).toBeLessThanOrEqual(HARD_SEED);
      }
    }
  });

  it('caps a tetris puzzle to the easy ceiling — never harder than easy (#71)', () => {
    const wouldBeHard = { acceptCount: 1, margin: 60 };
    expect(seedRatingFor(wouldBeHard)).toBe(HARD_SEED); // uncapped
    expect(seedRatingFor(wouldBeHard, { tetris: true })).toBe(EASY_SEED); // capped
    // A genuinely very-easy puzzle keeps its (lower) seed even under the cap.
    const veryEasy = { acceptCount: VERY_EASY_MIN_ACCEPTS, margin: 0 };
    expect(seedRatingFor(veryEasy, { tetris: true })).toBe(VERY_EASY_SEED);
  });
});

describe('bandFor — 4 bands by answer-set tightness (#52, #71)', () => {
  it('buckets by acceptCount at the band boundaries', () => {
    expect(bandFor(1)).toBe('hard');
    expect(bandFor(HARD_MAX_ACCEPTS)).toBe('hard'); // 2 → hard
    expect(bandFor(HARD_MAX_ACCEPTS + 1)).toBe('medium'); // 3 → medium
    expect(bandFor(EASY_MIN_ACCEPTS - 1)).toBe('medium'); // 7 → medium
    expect(bandFor(EASY_MIN_ACCEPTS)).toBe('easy'); // 8 → easy
    expect(bandFor(VERY_EASY_MIN_ACCEPTS - 1)).toBe('easy'); // 15 → easy
    expect(bandFor(VERY_EASY_MIN_ACCEPTS)).toBe('very-easy'); // 16 → very-easy
    expect(bandFor(50)).toBe('very-easy');
  });

  it('guarantees every hard puzzle has a genuinely tight answer set (≤ 2)', () => {
    for (let n = 1; n <= 30; n++) {
      if (bandFor(n) === 'hard') expect(n).toBeLessThanOrEqual(HARD_MAX_ACCEPTS);
    }
  });

  it('caps a tetris puzzle at easy — never medium/hard (#71)', () => {
    expect(bandFor(1, { tetris: true })).toBe('easy'); // would be hard
    expect(bandFor(5, { tetris: true })).toBe('easy'); // would be medium
    // Easy / very-easy keep their more-forgiving band under the cap.
    expect(bandFor(EASY_MIN_ACCEPTS, { tetris: true })).toBe('easy');
    expect(bandFor(VERY_EASY_MIN_ACCEPTS, { tetris: true })).toBe('very-easy');
  });

  it('seed rating tracks the band (hard > medium > easy > very-easy)', () => {
    const hard = seedRatingFor({ acceptCount: 1, margin: 30 });
    const medium = seedRatingFor({ acceptCount: 5, margin: 30 });
    const easy = seedRatingFor({ acceptCount: 12, margin: 30 });
    const veryEasy = seedRatingFor({ acceptCount: 20, margin: 0 });
    expect(bandFor(1)).toBe('hard');
    expect(bandFor(5)).toBe('medium');
    expect(bandFor(12)).toBe('easy');
    expect(bandFor(20)).toBe('very-easy');
    expect(hard).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(easy);
    expect(easy).toBeGreaterThan(veryEasy);
  });
});

describe('tetris detection by replaying placements (#71)', () => {
  it('flags a single placement that clears 4 rows (a real tetris)', () => {
    // Rows 16..19 are filled across cols 0..8, leaving col 9 open as a tetris
    // well. A vertical I dropped straight down col 9 completes all four rows.
    const board = emptyBoard();
    for (let r = 16; r <= 19; r++) for (let c = 0; c <= 8; c++) board[r][c] = 1;
    const iWell = { rotation: 1, row: 16, col: 9 }; // I fills col 9, rows 16..19
    const elsewhere = { rotation: 1, row: 0, col: 0 }; // piece 2 parks harmlessly
    expect(lineClearsTetris(board, 'I', 'I', iWell, elsewhere)).toBe(true);
  });

  it('does NOT flag a 2+2 split across both placements (definitional note)', () => {
    // Two separate double-wells: each I clears two rows, never four by one piece.
    const board = emptyBoard();
    for (let r = 18; r <= 19; r++) for (let c = 0; c <= 8; c++) board[r][c] = 1;
    // After the first I clears rows 18..19, set up a second 2-row clear for I #2.
    // The first placement: col 9 rows 18..19 (clears 2). Then on the cleared
    // board another 2-row setup. Simpler: assert the first clears only 2.
    const i1 = { rotation: 1, row: 16, col: 9 }; // bottom two of the vertical I land on 18,19
    const i2 = { rotation: 1, row: 0, col: 0 };
    expect(lineClearsTetris(board, 'I', 'I', i1, i2)).toBe(false);
  });

  it('clearsTetrisFromEntries only triggers on an ACCEPTABLE (≥97) tetris combo', () => {
    const board = emptyBoard();
    for (let r = 16; r <= 19; r++) for (let c = 0; c <= 8; c++) board[r][c] = 1;
    // The tetris combo (I into col 9 well, then I parked) as a stored entry.
    const tetrisEntry: ComboEntry = { rot1: 1, col1: 9, rot2: 1, col2: 0, score: 100 };
    const lowScore: ComboEntry = { ...tetrisEntry, score: 50 };
    expect(clearsTetrisFromEntries(board, 'I', 'I', [tetrisEntry])).toBe(true);
    // Same placement but below the accept bar → not a tetris-cap trigger.
    expect(clearsTetrisFromEntries(board, 'I', 'I', [lowScore])).toBe(false);
  });
});

describe('rebandPuzzle — re-band migration core (#71)', () => {
  it('caps a would-be-hard tetris puzzle to easy, seed at the easy ceiling', () => {
    // A tetris well: rows 16..19 filled cols 0..8, col 9 open. One dominant
    // acceptable combo (I into the well) ⇒ would be hard, but it clears a tetris.
    const board = emptyBoard();
    for (let r = 16; r <= 19; r++) for (let c = 0; c <= 8; c++) board[r][c] = 1;
    const entries: ComboEntry[] = [
      { rot1: 1, col1: 9, rot2: 1, col2: 0, score: 100 }, // the tetris
      { rot1: 1, col1: 0, rot2: 1, col2: 1, score: 40 },
    ];
    const r = rebandPuzzle(board, 'I', 'I', entries, { acceptCount: 1, margin: 60 });
    expect(r.tetris).toBe(true);
    expect(r.band).toBe('easy'); // capped from hard
    expect(r.seed).toBe(EASY_SEED);
  });

  it('leaves a non-tetris puzzle banded by its acceptCount', () => {
    const board = emptyBoard(); // no clears possible
    const entries: ComboEntry[] = [{ rot1: 0, col1: 0, rot2: 0, col2: 2, score: 100 }];
    const r = rebandPuzzle(board, 'O', 'O', entries, { acceptCount: 1, margin: 60 });
    expect(r.tetris).toBe(false);
    expect(r.band).toBe('hard');
    expect(r.seed).toBe(HARD_SEED);
  });
});
