// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  applyPlacement,
  boardMetrics,
  emptyBoard,
  encodeBoard,
  type Line,
  type Placement,
} from '@trainer/core';
import type { Attempt, NewAttempt, Puzzle, UserRating } from '@trainer/data';
import { PuzzleSession, type SessionDb } from './PuzzleSession.js';

afterEach(() => cleanup());

/** Build a deterministic, hand-checked puzzle from chosen optimal placements. */
function makePuzzle(): Puzzle {
  const board0 = emptyBoard();
  const line: Line = [
    { rotation: 0, col: 3 },
    { rotation: 0, col: 6 },
  ];
  const board1 = applyPlacement(board0, 'T', line[0]);
  const board2 = applyPlacement(board1, 'L', line[1]);
  return {
    id: 'puzzle-1',
    number: 1,
    board: encodeBoard(board0),
    piece1: 'T',
    piece2: 'L',
    optimalLine: line,
    optimalMetrics: boardMetrics(board2),
    glicko: { rating: 1500, deviation: 350, volatility: 0.06 },
    colors: '',
    // The optimal line is the rank-1 combo (score 100); anything else is unranked.
    combos: { entries: [{ rot1: 0, col1: 3, rot2: 0, col2: 6, score: 100 }], total: 18 },
    tags: [],
    acceptCount: null,
    margin: null,
    firstValues: [],
    secondValues: [],
  };
}

/** In-memory persistence that records what the session writes. */
function fakeDb() {
  const ratings = new Map<string, UserRating>();
  const attempts: NewAttempt[] = [];
  const db: SessionDb = {
    async getUserRating(userId) {
      return ratings.get(userId) ?? null;
    },
    async upsertUserRating(rating) {
      ratings.set(rating.userId, rating);
      return rating;
    },
    async insertAttempt(attempt): Promise<Attempt> {
      attempts.push(attempt);
      return {
        id: `attempt-${attempts.length}`,
        createdAt: '2026-01-01T00:00:00Z',
        ratingAfter: attempt.ratingAfter ?? null,
        ...attempt,
        score: attempt.score ?? null,
      };
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
    async getCurationTagStats() { return []; },
  };
  return { db, ratings, attempts };
}

/** Drive the on-screen outline to `target`, settle it to rest, and confirm (#89). */
async function place(user: ReturnType<typeof userEvent.setup>, target: Placement) {
  const input = () => screen.getByLabelText('placement input');
  for (let i = 0; i < 8 && Number(input().getAttribute('data-rotation')) !== target.rotation; i++) {
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
  }
  for (let i = 0; i < 20 && Number(input().getAttribute('data-col')) !== target.col; i++) {
    const current = Number(input().getAttribute('data-col'));
    await user.click(
      screen.getByRole('button', { name: current < target.col ? 'Move right' : 'Move left' }),
    );
  }
  // Confirm is gated on the resting glow (#89): soft-drop the outline to the
  // bottom of its column before locking.
  input().focus();
  for (let i = 0; i < 22 && input().getAttribute('data-resting') !== 'true'; i++) {
    await user.keyboard('{ArrowDown}');
  }
  await user.click(screen.getByRole('button', { name: 'Confirm placement' }));
}

describe('PuzzleSession (headline play loop)', () => {
  it('plays a puzzle to a solved outcome with a positive rating change, recording the attempt', async () => {
    const user = userEvent.setup();
    const puzzle = makePuzzle();
    const { db, attempts, ratings } = fakeDb();
    render(<PuzzleSession puzzle={puzzle} userId="u1" db={db} />);

    // Next piece is shown alongside the first piece.
    expect(screen.getByTestId('next-piece')).toHaveTextContent('L');

    await place(user, puzzle.optimalLine[0]); // correct first placement
    await place(user, puzzle.optimalLine[1]); // correct second placement

    expect(await screen.findByTestId('grade-banner')).toHaveAttribute('data-correct', 'true');
    expect(screen.getByTestId('rating-change')).toHaveTextContent('(+');

    // The attempt was recorded with both placements and solved = true.
    expect(attempts).toHaveLength(1);
    expect(attempts[0].solved).toBe(true);
    expect(attempts[0].userLine).toHaveLength(2);
    // The new (higher) rating was persisted.
    expect(ratings.get('u1')!.rating).toBeGreaterThan(1500);
  });

  it('still plays both pieces after a wrong first move, grading the combo as Incorrect', async () => {
    const user = userEvent.setup();
    const puzzle = makePuzzle();
    const { db, attempts } = fakeDb();
    render(<PuzzleSession puzzle={puzzle} userId="u2" db={db} />);

    // A first placement that is NOT the optimal column 3 — no short-circuit (#35).
    await place(user, { rotation: 0, col: 0 });
    // The session advanced to placement 2 (the second piece is now prompted).
    expect(await screen.findByText(/Place the/)).toHaveTextContent('L');
    await place(user, { rotation: 0, col: 6 });

    expect(await screen.findByTestId('grade-banner')).toHaveAttribute('data-correct', 'false');
    expect(screen.getByTestId('rating-change')).toHaveTextContent('(-');

    // Recorded as a two-placement, failed attempt.
    expect(attempts).toHaveLength(1);
    expect(attempts[0].solved).toBe(false);
    expect(attempts[0].userLine).toHaveLength(2);
  });

  it('advances to the next puzzle when asked', async () => {
    const user = userEvent.setup();
    const puzzle = makePuzzle();
    const { db } = fakeDb();
    const onNext = vi.fn();
    render(<PuzzleSession puzzle={puzzle} userId="u3" db={db} onNext={onNext} />);

    await place(user, { rotation: 0, col: 0 }); // place both to reach the result screen
    await place(user, { rotation: 0, col: 6 });
    await user.click(await screen.findByRole('button', { name: 'Next puzzle' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('drill mode grades + shows feedback but writes NO rating and NO attempt (#85)', async () => {
    const user = userEvent.setup();
    const puzzle = makePuzzle();
    const { db, attempts, ratings } = fakeDb();
    render(<PuzzleSession puzzle={puzzle} userId="u4" db={db} drill />);

    await place(user, puzzle.optimalLine[0]); // correct first placement
    await place(user, puzzle.optimalLine[1]); // correct second placement

    // Graded + feedback as usual…
    expect(await screen.findByTestId('grade-banner')).toHaveAttribute('data-correct', 'true');
    // …flagged as unrated practice, with no rating delta shown.
    expect(screen.getByTestId('drill-note')).toBeInTheDocument();
    expect(screen.queryByTestId('rating-change')).not.toBeInTheDocument();
    // The ephemeral attempt moved neither rating nor the attempts table.
    expect(attempts).toHaveLength(0);
    expect(ratings.get('u4')).toBeUndefined();
  });
});
