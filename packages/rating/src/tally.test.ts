import { describe, it, expect } from 'vitest';
import type { Glicko } from '@trainer/data';
import { ratePeriod, tallyPuzzleRatings, type TallyAttempt } from './tally.js';

const seed = (): Glicko => ({ rating: 1500, deviation: 350, volatility: 0.06 });

describe('ratePeriod (one Glicko-2 rating period for a subject)', () => {
  it('returns the subject unchanged when it played no games', () => {
    expect(ratePeriod(seed(), [])).toEqual(seed());
  });

  it('raises a puzzle that beat (was failed by) every player', () => {
    // Score is the SUBJECT (puzzle) perspective: 1 = the puzzle won (player failed).
    const after = ratePeriod(seed(), [
      { opponent: seed(), score: 1 },
      { opponent: seed(), score: 1 },
      { opponent: seed(), score: 1 },
    ]);
    expect(after.rating).toBeGreaterThan(1500);
    // More games tighten the deviation.
    expect(after.deviation).toBeLessThan(350);
  });

  it('lowers a puzzle that lost (was solved by) every player', () => {
    const after = ratePeriod(seed(), [
      { opponent: seed(), score: 0 },
      { opponent: seed(), score: 0 },
    ]);
    expect(after.rating).toBeLessThan(1500);
  });
});

describe('tallyPuzzleRatings (batch recompute from attempts)', () => {
  const puzzles = [
    { id: 'easy', glicko: seed() },
    { id: 'hard', glicko: seed() },
    { id: 'untouched', glicko: seed() },
  ];
  const users = new Map<string, Glicko>([
    ['u1', seed()],
    ['u2', seed()],
  ]);

  it('drops a solved-by-everyone puzzle and raises a failed-by-everyone one', () => {
    const attempts: TallyAttempt[] = [
      { puzzleId: 'easy', userId: 'u1', solved: true },
      { puzzleId: 'easy', userId: 'u2', solved: true },
      { puzzleId: 'hard', userId: 'u1', solved: false },
      { puzzleId: 'hard', userId: 'u2', solved: false },
    ];
    const updated = tallyPuzzleRatings(puzzles, attempts, users);
    expect(updated.get('easy')!.rating).toBeLessThan(1500);
    expect(updated.get('hard')!.rating).toBeGreaterThan(1500);
  });

  it('omits puzzles with no attempts (left unchanged)', () => {
    const attempts: TallyAttempt[] = [{ puzzleId: 'easy', userId: 'u1', solved: true }];
    const updated = tallyPuzzleRatings(puzzles, attempts, users);
    expect(updated.has('untouched')).toBe(false);
    expect(updated.has('easy')).toBe(true);
  });

  it('treats an unknown player as a fresh seed-rated opponent', () => {
    const attempts: TallyAttempt[] = [{ puzzleId: 'easy', userId: 'ghost', solved: true }];
    const updated = tallyPuzzleRatings(puzzles, attempts, new Map());
    expect(updated.get('easy')!.rating).toBeLessThan(1500);
  });
});
