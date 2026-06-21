import { describe, it, expect } from 'vitest';
import type { Attempt, Glicko, UserRating } from '@trainer/data';
import { tallyBankRatings, type TallyDeps } from './tally.js';

const seed = (): Glicko => ({ rating: 1500, deviation: 350, volatility: 0.06 });

function attempt(puzzleId: string, userId: string, solved: boolean): Attempt {
  return {
    id: `${puzzleId}-${userId}`,
    userId,
    puzzleId,
    userLine: [],
    solved,
    ratingAfter: null,
    createdAt: '2026-06-21T00:00:00Z',
  };
}

/** In-memory DataAccess stand-in capturing the rating writes. */
function fakeDeps(
  puzzles: { id: string; glicko: Glicko }[],
  attempts: Attempt[],
  users: UserRating[],
): { deps: TallyDeps; writes: Map<string, Glicko> } {
  const writes = new Map<string, Glicko>();
  const deps: TallyDeps = {
    async getAllPuzzleRatings() {
      return puzzles;
    },
    async getAllAttempts() {
      return attempts;
    },
    async getAllUserRatings() {
      return users;
    },
    async updatePuzzleRating(id, glicko) {
      writes.set(id, glicko);
    },
  };
  return { deps, writes };
}

describe('tallyBankRatings (offline puzzle-rating tally, #41)', () => {
  it('writes only attempted puzzles, lowering an easy one and raising a hard one', async () => {
    const puzzles = [
      { id: 'easy', glicko: seed() },
      { id: 'hard', glicko: seed() },
      { id: 'idle', glicko: seed() },
    ];
    const attempts = [
      attempt('easy', 'u1', true),
      attempt('easy', 'u2', true),
      attempt('hard', 'u1', false),
      attempt('hard', 'u2', false),
    ];
    const users: UserRating[] = [
      { userId: 'u1', ...seed() },
      { userId: 'u2', ...seed() },
    ];
    const { deps, writes } = fakeDeps(puzzles, attempts, users);

    const result = await tallyBankRatings(deps);

    expect(result).toEqual({ puzzles: 3, attempts: 4, updated: 2 });
    expect(writes.has('idle')).toBe(false);
    expect(writes.get('easy')!.rating).toBeLessThan(1500);
    expect(writes.get('hard')!.rating).toBeGreaterThan(1500);
  });

  it('is a no-op with no attempts', async () => {
    const { deps, writes } = fakeDeps([{ id: 'p', glicko: seed() }], [], []);
    const result = await tallyBankRatings(deps);
    expect(result.updated).toBe(0);
    expect(writes.size).toBe(0);
  });
});
