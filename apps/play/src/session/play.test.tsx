// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { applyPlacement, boardMetrics, emptyBoard, encodeBoard, type Line } from '@trainer/core';
import type { Attempt, NewAttempt, Puzzle, UserRating } from '@trainer/data';
import { PuzzlePlay, type PlayDb } from './PuzzlePlay.js';

afterEach(() => cleanup());

function samplePuzzle(): Puzzle {
  const line: Line = [
    { rotation: 0, col: 3 },
    { rotation: 0, col: 6 },
  ];
  const board2 = applyPlacement(applyPlacement(emptyBoard(), 'T', line[0]), 'L', line[1]);
  return {
    id: 'p1',
    number: 1,
    board: encodeBoard(emptyBoard()),
    piece1: 'T',
    piece2: 'L',
    optimalLine: line,
    optimalMetrics: boardMetrics(board2),
    glicko: { rating: 1500, deviation: 350, volatility: 0.06 },
    colors: '',
    combos: { entries: [], total: 0 },
    tags: [],
    acceptCount: null,
    margin: null,
    firstValues: [],
    secondValues: [],
  };
}

function makeDb(puzzle: Puzzle | null): PlayDb {
  const ratings = new Map<string, UserRating>();
  return {
    async getMatchmadePuzzle() {
      return puzzle;
    },
    async fetchPuzzlesByTags() {
      return [];
    },
    async getPuzzleByNumber() {
      return null;
    },
    async getRecentAttemptedPuzzleIds() {
      return [];
    },
    async getUserRating(userId) {
      return ratings.get(userId) ?? null;
    },
    async upsertUserRating(rating) {
      ratings.set(rating.userId, rating);
      return rating;
    },
    async getPuzzleSolveStats() {
      return { total: 0, solved: 0 };
    },
    async upsertStarRating() {},
    async getMyStarRating() {
      return null;
    },
    async getStarStats() {
      return { avg: 0, count: 0 };
    },
    async getPuzzle() {
      return null;
    },
    async getMissPuzzleIds() {
      return [];
    },
    async isAdmin() {
      return false;
    },
    async flagPuzzle() {},
    async cullPuzzle() {},
    async setPuzzleActive() {},
    async insertAttempt(attempt: NewAttempt): Promise<Attempt> {
      return {
        id: 'a1',
        createdAt: '2026-01-01T00:00:00Z',
        ratingAfter: attempt.ratingAfter ?? null,
        ...attempt,
        score: attempt.score ?? null,
      };
    },
  };
}

describe('PuzzlePlay (load a puzzle from the bank)', () => {
  it('loads a random puzzle and presents it', async () => {
    render(<PuzzlePlay db={makeDb(samplePuzzle())} userId="u1" />);
    expect(await screen.findByTestId('next-piece')).toHaveTextContent('L');
  });

  it('shows an empty-bank message when there are no puzzles', async () => {
    render(<PuzzlePlay db={makeDb(null)} userId="u1" />);
    expect(await screen.findByText(/No puzzles in the bank yet/)).toBeInTheDocument();
  });
});

/** A puzzle with a chosen number so the title distinguishes which one loaded. */
function numbered(n: number): Puzzle {
  return { ...samplePuzzle(), id: `p${n}`, number: n };
}

/** A db that records which selector was called, with distinct shared/matchmade puzzles. */
function trackingDb() {
  const calls: string[] = [];
  const ratings = new Map<string, UserRating>();
  const db: PlayDb = {
    async getMatchmadePuzzle() {
      calls.push('matchmade');
      return numbered(99);
    },
    async fetchPuzzlesByTags() {
      return [];
    },
    async getPuzzleByNumber(n) {
      calls.push(`byNumber:${n}`);
      return n === 5 ? numbered(5) : null; // only #5 exists
    },
    async getRecentAttemptedPuzzleIds() {
      return [];
    },
    async getUserRating(userId) {
      return ratings.get(userId) ?? null;
    },
    async upsertUserRating(rating) {
      ratings.set(rating.userId, rating);
      return rating;
    },
    async getPuzzleSolveStats() {
      return { total: 0, solved: 0 };
    },
    async upsertStarRating() {},
    async getMyStarRating() {
      return null;
    },
    async getStarStats() {
      return { avg: 0, count: 0 };
    },
    async getPuzzle() {
      return null;
    },
    async getMissPuzzleIds() {
      return [];
    },
    async isAdmin() {
      return false;
    },
    async flagPuzzle() {},
    async cullPuzzle() {},
    async setPuzzleActive() {},
    async insertAttempt(attempt: NewAttempt): Promise<Attempt> {
      return {
        id: 'a1',
        createdAt: '2026-01-01T00:00:00Z',
        ratingAfter: null,
        ...attempt,
        score: attempt.score ?? null,
      };
    },
  };
  return { db, calls };
}

describe('PuzzlePlay persistent anti-repeat window (#74)', () => {
  it('hydrates the 200-window from attempts and passes it to matchmaking', async () => {
    let passed: readonly string[] | undefined;
    const ratings = new Map<string, UserRating>();
    const db: PlayDb = {
      async getMatchmadePuzzle(opts) {
        passed = opts.recentIds;
        return samplePuzzle();
      },
      async fetchPuzzlesByTags() {
        return [];
      },
      async getPuzzleByNumber() {
        return null;
      },
      async getRecentAttemptedPuzzleIds() {
        return ['seen-a', 'seen-b'];
      },
      async getUserRating(userId) {
        return ratings.get(userId) ?? null;
      },
      async upsertUserRating(rating) {
        ratings.set(rating.userId, rating);
        return rating;
      },
      async getPuzzleSolveStats() {
        return { total: 0, solved: 0 };
      },
      async upsertStarRating() {},
      async getMyStarRating() {
        return null;
      },
      async getStarStats() {
        return { avg: 0, count: 0 };
      },
      async getPuzzle() {
        return null;
      },
      async getMissPuzzleIds() {
        return [];
      },
      async isAdmin() {
        return false;
      },
      async flagPuzzle() {},
      async cullPuzzle() {},
      async setPuzzleActive() {},
      async insertAttempt(attempt: NewAttempt): Promise<Attempt> {
        return { id: 'a1', createdAt: 'x', ratingAfter: null, ...attempt, score: null };
      },
    };
    render(<PuzzlePlay db={db} userId="u1" />);
    expect(await screen.findByTestId('next-piece')).toHaveTextContent('L');
    // The window loaded from `attempts` is fed to matchmaking as `recentIds`.
    expect(passed).toEqual(['seen-a', 'seen-b']);
  });
});

describe('PuzzlePlay shared-puzzle link (#49)', () => {
  it('opens the exact shared puzzle by number, bypassing matchmaking', async () => {
    const { db, calls } = trackingDb();
    render(<PuzzlePlay db={db} userId="u1" initialPuzzleNumber={5} />);
    expect(await screen.findByText(/Puzzle #5/)).toBeInTheDocument();
    expect(calls).toEqual(['byNumber:5']); // matchmaking not consulted
  });

  it('falls back to matchmaking when no shared number is given', async () => {
    const { db, calls } = trackingDb();
    render(<PuzzlePlay db={db} userId="u1" />);
    expect(await screen.findByText(/Puzzle #99/)).toBeInTheDocument();
    expect(calls).toEqual(['matchmade']);
  });

  it('falls back to matchmaking when the shared number does not exist', async () => {
    const { db, calls } = trackingDb();
    render(<PuzzlePlay db={db} userId="u1" initialPuzzleNumber={404} />);
    expect(await screen.findByText(/Puzzle #99/)).toBeInTheDocument();
    expect(calls).toEqual(['byNumber:404', 'matchmade']);
  });
});

/**
 * A db whose miss set + by-id lookups are configurable, tracking which selector
 * served. Misses map to numbered puzzles (m11 → #11, …); matchmaking serves #99.
 */
function missDb(opts: { misses?: string[]; window?: string[] } = {}) {
  const calls: string[] = [];
  const numOf = (id: string) => Number(id.replace('m', ''));
  const db: PlayDb = {
    async getMatchmadePuzzle() {
      calls.push('matchmade');
      return numbered(99);
    },
    async fetchPuzzlesByTags() {
      return [];
    },
    async getPuzzle(id) {
      calls.push(`getPuzzle:${id}`);
      return numbered(numOf(id));
    },
    async getPuzzleByNumber() {
      return null;
    },
    async getRecentAttemptedPuzzleIds() {
      return opts.window ?? [];
    },
    async getMissPuzzleIds() {
      return opts.misses ?? [];
    },
    async getUserRating() {
      return null;
    },
    async upsertUserRating(r) {
      return r;
    },
    async getPuzzleSolveStats() {
      return { total: 0, solved: 0 };
    },
    async upsertStarRating() {},
    async getMyStarRating() {
      return null;
    },
    async getStarStats() {
      return { avg: 0, count: 0 };
    },
    async isAdmin() {
      return false;
    },
    async flagPuzzle() {},
    async cullPuzzle() {},
    async setPuzzleActive() {},
    async insertAttempt(attempt: NewAttempt): Promise<Attempt> {
      return { id: 'a1', createdAt: 'x', ratingAfter: null, ...attempt, score: null };
    },
  };
  return { db, calls };
}

describe('PuzzlePlay miss replay (#75)', () => {
  it('Review-misses mode serves the oldest miss first, bypassing matchmaking', async () => {
    const { db, calls } = missDb({ misses: ['m11', 'm12'] });
    render(<PuzzlePlay db={db} userId="u1" reviewMode />);
    // Oldest miss (#11) is served by id; matchmaking is never consulted.
    expect(await screen.findByText(/Puzzle #11/)).toBeInTheDocument();
    expect(calls).toEqual(['getPuzzle:m11']);
  });

  it('Review-misses mode shows an empty state when there are no misses', async () => {
    const { db } = missDb({ misses: [] });
    render(<PuzzlePlay db={db} userId="u1" reviewMode />);
    expect(await screen.findByText(/No misses to review/)).toBeInTheDocument();
  });

  it('normal play auto-injects the oldest DUE miss when the rate fires (#75)', async () => {
    // m11 is a due miss (window empty). random < 0.1 forces the injection.
    const { db, calls } = missDb({ misses: ['m11'], window: [] });
    render(<PuzzlePlay db={db} userId="u1" random={() => 0} />);
    expect(await screen.findByText(/Puzzle #11/)).toBeInTheDocument();
    expect(calls).toEqual(['getPuzzle:m11']); // injected, NOT matchmade
  });

  it('normal play stays fresh when the rate does not fire', async () => {
    const { db, calls } = missDb({ misses: ['m11'], window: [] });
    render(<PuzzlePlay db={db} userId="u1" random={() => 0.9} />);
    expect(await screen.findByText(/Puzzle #99/)).toBeInTheDocument();
    expect(calls).toEqual(['matchmade']); // fresh, no injection
  });

  it('normal play never injects a miss still inside the window (not due)', async () => {
    // m11 IS in the window → not due → no injection even with random 0.
    const { db, calls } = missDb({ misses: ['m11'], window: ['m11'] });
    render(<PuzzlePlay db={db} userId="u1" random={() => 0} />);
    expect(await screen.findByText(/Puzzle #99/)).toBeInTheDocument();
    expect(calls).toEqual(['matchmade']);
  });
});
