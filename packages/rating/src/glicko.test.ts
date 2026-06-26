import { describe, it, expect } from 'vitest';
import type { DataAccess, Glicko, UserRating } from '@trainer/data';
import { SEED_DEVIATION } from '@trainer/data';
import {
  updateRatings,
  applyAttempt,
  seedRating,
  scoreToOutcome,
  attemptOutcome,
  placementBoost,
  boostMove,
  PLACEMENT_BOOST_MAX,
  SETTLED_DEVIATION,
  MAX_BOOSTED_DELTA,
  NEUTRAL_OUTCOME,
  NEUTRAL_SCORE,
  OUTCOME_FLOOR,
} from './glicko.js';

const seed = (): Glicko => ({ rating: 1500, deviation: 350, volatility: 0.06 });

describe('scoreToOutcome (graded reward curve, #51)', () => {
  it('maps the 97 accept bar to a neutral outcome (#60)', () => {
    expect(NEUTRAL_SCORE).toBe(97);
    expect(scoreToOutcome(NEUTRAL_SCORE)).toBeCloseTo(0.5, 10);
  });

  it('maps a perfect 100 to a full win and is convex above the bar (#60)', () => {
    expect(scoreToOutcome(100)).toBeCloseTo(1.0, 10);
    expect(scoreToOutcome(98)).toBeCloseTo(0.56, 2);
    expect(scoreToOutcome(99)).toBeCloseTo(0.72, 2);
  });

  it('is monotonically non-decreasing in score', () => {
    let prev = -Infinity;
    for (let s = 70; s <= 100; s++) {
      const o = scoreToOutcome(s);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
  });

  it('docks below the bar and floors at OUTCOME_FLOOR for bad misses (#60)', () => {
    expect(scoreToOutcome(95)).toBeCloseTo(0.45, 2);
    expect(scoreToOutcome(80)).toBeCloseTo(OUTCOME_FLOOR, 10);
    expect(scoreToOutcome(50)).toBe(OUTCOME_FLOOR);
  });

  it('docks a bad miss harder than a near-miss is rewarded', () => {
    const reward = scoreToOutcome(98) - NEUTRAL_OUTCOME;
    const dock = NEUTRAL_OUTCOME - scoreToOutcome(80);
    expect(dock).toBeGreaterThan(reward);
  });
});

describe('attemptOutcome (score | null -> outcome, with binary fallback)', () => {
  it('uses the graded curve when a numeric score is present', () => {
    expect(attemptOutcome(100, true)).toBeCloseTo(1.0, 10);
    expect(attemptOutcome(97, true)).toBeCloseTo(0.5, 10);
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

  it('rewards a 100 (full credit) more than a 98 (near-miss) (#60)', () => {
    const full = updateRatings(seed(), seed(), scoreToOutcome(100));
    const near = updateRatings(seed(), seed(), scoreToOutcome(98));
    expect(full.user.rating).toBeGreaterThan(near.user.rating);
    // 98 is above the neutral bar (97), so it is still a (small) gain.
    expect(near.user.rating).toBeGreaterThan(1500);
  });

  it('leaves both ratings essentially unchanged at the neutral bar (97) (#60)', () => {
    const neutral = updateRatings(seed(), seed(), scoreToOutcome(97));
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

  it('scales the gain by answer quality — a 98 gains less than a 100 (#60)', async () => {
    const near = await applyAttempt(fakeDb().db, 'u', seed(), scoreToOutcome(98));
    const full = await applyAttempt(fakeDb().db, 'u', seed(), scoreToOutcome(100));
    expect(near.delta).toBeGreaterThan(0);
    expect(near.delta).toBeLessThan(full.delta);
  });
});

describe('placementBoost (strong-early-then-settle, #99)', () => {
  it('is PLACEMENT_BOOST_MAX at the seed RD and 1 at/below the settled RD', () => {
    expect(placementBoost(SEED_DEVIATION)).toBeCloseTo(PLACEMENT_BOOST_MAX, 10);
    expect(placementBoost(SETTLED_DEVIATION)).toBeCloseTo(1, 10);
    expect(placementBoost(SETTLED_DEVIATION - 50)).toBe(1);
  });

  it('decreases monotonically as RD shrinks (the boost tapers)', () => {
    let prev = Infinity;
    for (let rd = SEED_DEVIATION; rd >= 50; rd -= 10) {
      const b = placementBoost(rd);
      expect(b).toBeLessThanOrEqual(prev);
      prev = b;
    }
  });
});

describe('boostMove (apply the placement boost to one side, #99)', () => {
  it('amplifies a move at the seed RD and is a no-op once settled', () => {
    const fresh: Glicko = { rating: 1500, deviation: SEED_DEVIATION, volatility: 0.06 };
    const settled: Glicko = { rating: 1500, deviation: SETTLED_DEVIATION - 10, volatility: 0.06 };
    const after = (rd: number): Glicko => ({ rating: 1510, deviation: rd, volatility: 0.06 });
    // +10 raw at the seed RD → ×PLACEMENT_BOOST_MAX (well under the cap).
    expect(boostMove(fresh, after(300)).rating - 1500).toBeCloseTo(10 * PLACEMENT_BOOST_MAX, 6);
    // At a settled RD the boost is 1× — the move passes through unchanged.
    expect(boostMove(settled, after(90)).rating - 1500).toBeCloseTo(10, 6);
  });

  it('caps a single boosted move at ±MAX_BOOSTED_DELTA so no attempt teleports', () => {
    const fresh: Glicko = { rating: 1500, deviation: SEED_DEVIATION, volatility: 0.06 };
    const up: Glicko = { rating: 1700, deviation: 300, volatility: 0.06 }; // +200 raw ×3 = 600
    const down: Glicko = { rating: 1300, deviation: 300, volatility: 0.06 };
    expect(boostMove(fresh, up).rating - 1500).toBe(MAX_BOOSTED_DELTA);
    expect(boostMove(fresh, down).rating - 1500).toBe(-MAX_BOOSTED_DELTA);
  });

  it('touches only the rating — RD and volatility keep their Glicko-computed values', () => {
    const before: Glicko = { rating: 1500, deviation: SEED_DEVIATION, volatility: 0.06 };
    const after: Glicko = { rating: 1505, deviation: 300, volatility: 0.061 };
    const boosted = boostMove(before, after);
    expect(boosted.deviation).toBe(300);
    expect(boosted.volatility).toBe(0.061);
  });
});

describe('applyAttempt placement boost (#99)', () => {
  it('moves a fresh (high-RD) player far more than a settled one for the same outcome', async () => {
    const puzzle = seed();
    const outcome = scoreToOutcome(99);

    const fresh = await applyAttempt(fakeDb().db, 'u', puzzle, outcome);
    const rawFresh = updateRatings(seed(), puzzle, outcome).user.rating - 1500;
    // The seed-RD boost is 3×, so the persisted move is well above the raw Glicko move.
    expect(fresh.delta).toBeGreaterThan(rawFresh * 1.5);

    const settledStart: UserRating = {
      userId: 'u',
      rating: 1500,
      deviation: SETTLED_DEVIATION - 20,
      volatility: 0.06,
    };
    const settled = await applyAttempt(fakeDb(settledStart).db, 'u', puzzle, outcome);
    const rawSettled =
      updateRatings(
        { rating: 1500, deviation: SETTLED_DEVIATION - 20, volatility: 0.06 },
        puzzle,
        outcome,
      ).user.rating - 1500;
    // Below the settled RD the boost is 1× — the persisted move equals the raw move.
    expect(settled.delta).toBeCloseTo(rawSettled, 6);
    // And the fresh player moves much further than the settled one on the same answer.
    expect(fresh.delta).toBeGreaterThan(settled.delta * 2);
  });

  it('returns the puzzle\'s boosted drift for the app to persist live', async () => {
    const result = await applyAttempt(fakeDb().db, 'u', seed(), scoreToOutcome(99));
    // A strong solve drives the puzzle DOWN, boosted from its seed RD.
    expect(result.puzzle.rating).toBeLessThan(1500);
    const rawPuzzle = updateRatings(seedRating(), seed(), scoreToOutcome(99)).puzzle.rating;
    expect(1500 - result.puzzle.rating).toBeGreaterThan((1500 - rawPuzzle) * 1.5);
  });
});
