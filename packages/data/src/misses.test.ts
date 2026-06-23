import { describe, it, expect } from 'vitest';
import {
  missPuzzleIds,
  dueMisses,
  shouldInjectMiss,
  MISS_INJECT_RATE,
  type MissAttempt,
} from './misses.js';

const a = (puzzleId: string, solved: boolean): MissAttempt => ({ puzzleId, solved });

describe('missPuzzleIds (miss-set definition, #75)', () => {
  it('is a puzzle attempted ≥1 time with NO solved attempt, oldest-first', () => {
    // Ascending by time: p1 missed, p2 missed, p3 solved, p1 missed again.
    const attempts = [a('p1', false), a('p2', false), a('p3', true), a('p1', false)];
    // p3 is solved (out); p1 and p2 remain, ordered by earliest attempt.
    expect(missPuzzleIds(attempts)).toEqual(['p1', 'p2']);
  });

  it('removes a puzzle from the set once it is solved (set-exit on solve)', () => {
    // p1 missed twice then finally solved → leaves the set.
    const attempts = [a('p1', false), a('p1', false), a('p1', true)];
    expect(missPuzzleIds(attempts)).toEqual([]);
  });

  it('keeps a re-missed puzzle in the set', () => {
    const attempts = [a('p1', false), a('p2', true), a('p1', false)];
    expect(missPuzzleIds(attempts)).toEqual(['p1']);
  });
});

describe('dueMisses (#75)', () => {
  it('keeps only misses that have fallen out of the anti-repeat window', () => {
    const misses = ['p1', 'p2', 'p3'];
    // p2 is still inside the recent window → not due; order preserved.
    expect(dueMisses(misses, ['p2', 'pX'])).toEqual(['p1', 'p3']);
  });
});

describe('shouldInjectMiss (~1-in-10 rate, #75)', () => {
  it('is false when no miss is due, whatever the draw', () => {
    expect(shouldInjectMiss(0, 0)).toBe(false);
    expect(shouldInjectMiss(0.99, 0)).toBe(false);
  });

  it('injects on ~10% of draws when a miss is due', () => {
    // Uniform draws across [0,1): exactly the fraction below MISS_INJECT_RATE.
    let injected = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (shouldInjectMiss(i / N, 1)) injected++;
    }
    expect(MISS_INJECT_RATE).toBe(0.1);
    expect(injected / N).toBeCloseTo(0.1, 2); // ≈ 1 in 10
  });
});
