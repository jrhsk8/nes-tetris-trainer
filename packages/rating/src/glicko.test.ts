import { describe, it, expect } from 'vitest';
import type { DataAccess, Glicko, UserRating } from '@trainer/data';
import {
  updateRatings,
  applyAttempt,
  seedRating,
  scoreToOutcome,
  attemptOutcome,
  NEUTRAL_OUTCOME,
  NEUTRAL_SCORE,
  OUTCOME_FLOOR,
} from './glicko.js';

const seed = (): Glicko => ({ rating: 1500, deviation: 350, volatility: 0.06 });

describe('scoreToOutcome (graded reward curve, #51)', () => {
  it('maps the 95 accept bar to a neutral outcome', () => {
    expect(scoreToOutcome(NEUTRAL_SCORE)).toBeCloseTo(0.5, 10);
  });

  it('maps a perfect 100 to a full win and is convex above the bar', () => {
    expect(scoreToOutcome(100)).toBeCloseTo(1.0, 10);
    expect(scoreToOutcome(97)).toBeCloseTo(0.58, 2);
    expect(scoreToOutcome(99)).toBeCloseTo(0.82, 2);
  });

  it('is monotonically non-decreasing in score', () => {
    let prev = -Infinity;
    for (let s = 70; s <= 100; s++) {
      const o = scoreToOutcome(s);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
  });

  it('docks below the bar and floors at OUTCOME_FLOOR for bad misses', () => {
    expect(scoreToOutcome(93)).toBeCloseTo(0.45, 2);
    expect(scoreToOutcome(80)).toBeCloseTo(OUTCOME_FLOOR, 10);
    expect(scoreToOutcome(50)).toBe(OUTCOME_FLOOR);
  });

  it('docks a bad miss harder than a near-miss is rewarded', () => {
    const reward = scoreToOutcome(97) - NEUTRAL_OUTCOME;
    const dock = NEUTRAL_OUTCOME - scoreToOutcome(80);
    expect(dock).toBeGreaterThan(reward);
  });
});

describe('attemptOutcome (score | null -> outcome, with binary fallback)', () => {
  it('uses the graded curve when a numeric score is present', () => {
    expect(attemptOutcome(100, true)).toBeCloseTo(1.0, 10);
    expect(attemptOutcome(95, true)).toBeCloseTo(0.5, 10);
  });

  it('falls back to the binary solved signal when score is null (legacy/unranked)', () => {
    expect(attemptOutcome(null, true)).toBe(1);
    expect(attemptOutcome(null, false)).toBe(0);
  });
});

describe('updateRatings (outcome -> co-rating mapping)', () => {
  it('moves the player up and the puzzle down on a win', () => {
    const result = updateRatings(seed(), seed(), 1);
    expect(result.user.rating).toBeGreaterThan(1500);
    expect(result.puzzle.rating).toBeLessThan(1500);
  });

  it('moves the player down and the puzzle up on a loss', () => {
    const result = updateRatings(seed(), seed(), 0);
    expect(result.user.rating).toBeLessThan(1500);
    expect(result.puzzle.rating).toBeGreaterThan(1500);
  });

  it('rewards a 100 (full credit) more than a 97 (near-miss)', () => {
    const full = updateRatings(seed(), seed(), scoreToOutcome(100));
    const near = updateRatings(seed(), seed(), scoreToOutcome(97));
    expect(full.user.rating).toBeGreaterThan(near.user.rating);
    // 97 is above the neutral bar, so it is still a (small) gain.
    expect(near.user.rating).toBeGreaterThan(1500);
  });

  it('leaves both ratings essentially unchanged at the neutral bar (95)', () => {
    const neutral = updateRatings(seed(), seed(), scoreToOutcome(95));
    expect(neutral.user.rating).toBeCloseTo(1500, 0);
  });

  it('rewards solving a higher-rated puzzle more than a lower-rated one', () => {
    const harder = updateRatings(seed(), { rating: 1800, deviation: 350, volatility: 0.06 }, 1);
    const easier = updateRatings(seed(), { rating: 1200, deviation: 350, volatility: 0.06 }, 1);
    expect(harder.user.rating).toBeGreaterThan(easier.user.rating);
  });
});

/** A minimal in-memory stand-in for the persistence the glue needs. */
function fakeDb(initial?: UserRating) {
  const store = new Map<string, UserRating>();
  if (initial) store.set(initial.userId, initial);
  const db: Pick<DataAccess, 'getUserRating' | 'upsertUserRating'> = {
    async getUserRating(userId) {
      return store.get(userId) ?? null;
    },
    async upsertUserRating(rating) {
      store.set(rating.userId, rating);
      return rating;
    },
  };
  return { db, store };
}

describe('applyAttempt (compute + persist)', () => {
  it('seeds a new player, then persists a higher rating on a win', async () => {
    const { db, store } = fakeDb();
    const result = await applyAttempt(db, 'user-1', seed(), 1);

    expect(result.before).toEqual(seedRating());
    expect(result.delta).toBeGreaterThan(0);
    // The new rating was written through to storage.
    expect(store.get('user-1')!.rating).toBe(result.after.rating);
    expect(result.after.rating).toBeGreaterThan(1500);
  });

  it('lowers and persists an existing rating on a loss', async () => {
    const { db, store } = fakeDb({
      userId: 'user-2',
      rating: 1600,
      deviation: 200,
      volatility: 0.06,
    });
    const result = await applyAttempt(db, 'user-2', seed(), 0);

    expect(result.before.rating).toBe(1600);
    expect(result.delta).toBeLessThan(0);
    expect(store.get('user-2')!.rating).toBe(result.after.rating);
    expect(result.after.rating).toBeLessThan(1600);
  });

  it('scales the gain by answer quality — a 97 gains less than a 100', async () => {
    const near = await applyAttempt(fakeDb().db, 'u', seed(), scoreToOutcome(97));
    const full = await applyAttempt(fakeDb().db, 'u', seed(), scoreToOutcome(100));
    expect(near.delta).toBeGreaterThan(0);
    expect(near.delta).toBeLessThan(full.delta);
  });
});
