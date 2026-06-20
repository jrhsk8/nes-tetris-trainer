import { describe, it, expect } from 'vitest';
import type { DataAccess, Glicko, UserRating } from '@trainer/data';
import { updateRatings, applyAttempt, seedRating } from './glicko.js';

const seed = (): Glicko => ({ rating: 1500, deviation: 350, volatility: 0.06 });

describe('updateRatings (outcome -> co-rating mapping)', () => {
  it('moves the player up and the puzzle down on a solve', () => {
    const result = updateRatings(seed(), seed(), true);
    expect(result.user.rating).toBeGreaterThan(1500);
    expect(result.puzzle.rating).toBeLessThan(1500);
  });

  it('moves the player down and the puzzle up on a failure', () => {
    const result = updateRatings(seed(), seed(), false);
    expect(result.user.rating).toBeLessThan(1500);
    expect(result.puzzle.rating).toBeGreaterThan(1500);
  });

  it('rewards solving a higher-rated puzzle more than a lower-rated one', () => {
    const harder = updateRatings(seed(), { rating: 1800, deviation: 350, volatility: 0.06 }, true);
    const easier = updateRatings(seed(), { rating: 1200, deviation: 350, volatility: 0.06 }, true);
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
  it('seeds a new player, then persists a higher rating on a solve', async () => {
    const { db, store } = fakeDb();
    const result = await applyAttempt(db, 'user-1', seed(), true);

    expect(result.before).toEqual(seedRating());
    expect(result.delta).toBeGreaterThan(0);
    // The new rating was written through to storage.
    expect(store.get('user-1')!.rating).toBe(result.after.rating);
    expect(result.after.rating).toBeGreaterThan(1500);
  });

  it('lowers and persists an existing rating on a failure', async () => {
    const { db, store } = fakeDb({
      userId: 'user-2',
      rating: 1600,
      deviation: 200,
      volatility: 0.06,
    });
    const result = await applyAttempt(db, 'user-2', seed(), false);

    expect(result.before.rating).toBe(1600);
    expect(result.delta).toBeLessThan(0);
    expect(store.get('user-2')!.rating).toBe(result.after.rating);
    expect(result.after.rating).toBeLessThan(1600);
  });
});
