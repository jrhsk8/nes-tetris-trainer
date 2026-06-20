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
    board: encodeBoard(board0),
    piece1: 'T',
    piece2: 'L',
    optimalLine: line,
    optimalMetrics: boardMetrics(board2),
    glicko: { rating: 1500, deviation: 350, volatility: 0.06 },
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
      };
    },
  };
  return { db, ratings, attempts };
}

/** Drive the on-screen ghost to `target` and confirm. */
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

    expect(await screen.findByTestId('outcome')).toHaveTextContent('Solved!');
    expect(screen.getByTestId('rating-change')).toHaveTextContent('(+');

    // The attempt was recorded with both placements and solved = true.
    expect(attempts).toHaveLength(1);
    expect(attempts[0].solved).toBe(true);
    expect(attempts[0].userLine).toHaveLength(2);
    // The new (higher) rating was persisted.
    expect(ratings.get('u1')!.rating).toBeGreaterThan(1500);
  });

  it('ends immediately on a wrong first move and reveals the result (negative rating change)', async () => {
    const user = userEvent.setup();
    const puzzle = makePuzzle();
    const { db, attempts } = fakeDb();
    render(<PuzzleSession puzzle={puzzle} userId="u2" db={db} />);

    // Confirm a first placement that is NOT the optimal column 3.
    await place(user, { rotation: 0, col: 0 });

    expect(await screen.findByTestId('outcome')).toHaveTextContent('Not solved');
    expect(screen.getByTestId('rating-change')).toHaveTextContent('(-');

    // Recorded as a single-placement, failed attempt (no second move played).
    expect(attempts).toHaveLength(1);
    expect(attempts[0].solved).toBe(false);
    expect(attempts[0].userLine).toHaveLength(1);
  });

  it('advances to the next puzzle when asked', async () => {
    const user = userEvent.setup();
    const puzzle = makePuzzle();
    const { db } = fakeDb();
    const onNext = vi.fn();
    render(<PuzzleSession puzzle={puzzle} userId="u3" db={db} onNext={onNext} />);

    await place(user, { rotation: 0, col: 0 }); // quick fail to reach the result screen
    await user.click(await screen.findByRole('button', { name: 'Next puzzle' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
