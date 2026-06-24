// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { applyPlacement, boardMetrics, emptyBoard, encodeBoard, type Line } from '@trainer/core';
import type { Attempt, NewAttempt, Puzzle, UserRating } from '@trainer/data';
import { PuzzlePlay, type PlayDb } from './PuzzlePlay.js';

afterEach(() => cleanup());

function samplePuzzle(id: string): Puzzle {
  const line: Line = [
    { rotation: 0, col: 3 },
    { rotation: 0, col: 6 },
  ];
  const board2 = applyPlacement(applyPlacement(emptyBoard(), 'T', line[0]), 'L', line[1]);
  return {
    id,
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

/** A db whose getMatchmadePuzzle hands back a fresh-id puzzle and counts calls. */
function countingDb(): { db: PlayDb; calls: () => number } {
  let n = 0;
  const ratings = new Map<string, UserRating>();
  const db: PlayDb = {
    async getMatchmadePuzzle() {
      n += 1;
      return samplePuzzle(`p${n}`);
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
    async isCurator() {
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
  return { db, calls: () => n };
}

/**
 * Mimics how {@link Account} mounts the play loop (#13): an *unstable* inline
 * `onAdvance` that, when called, triggers a parent re-render (its rating-history
 * refresh). This is exactly the coupling that caused the #17 flashing loop —
 * each render produced a new `onAdvance`, the loader's effect re-fired, and a
 * fresh puzzle was selected every frame.
 */
function AccountLikeHarness({ db }: { db: PlayDb }) {
  const [, setRefreshes] = useState(0);
  return (
    <PuzzlePlay db={db} userId="u1" onAdvance={() => setRefreshes((x) => x + 1)} />
  );
}

describe('PuzzlePlay render-loop safety (#17)', () => {
  it('selects a puzzle exactly once and keeps it fixed, despite an unstable onAdvance', async () => {
    const { db, calls } = countingDb();
    render(<AccountLikeHarness db={db} />);

    // The puzzle appears and settles.
    expect(await screen.findByTestId('next-piece')).toBeInTheDocument();

    // Give any runaway effect ample opportunity to re-fire. With the bug, the
    // loader re-selects a puzzle on every render and `calls` climbs without
    // bound; once fixed it stays at exactly one.
    await waitFor(() => expect(calls()).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls()).toBe(1);

    // And exactly one active puzzle/board is on screen (not many cycled).
    expect(screen.getAllByLabelText('placement input')).toHaveLength(1);
  });
});
