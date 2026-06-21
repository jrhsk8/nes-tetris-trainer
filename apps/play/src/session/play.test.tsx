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
    board: encodeBoard(emptyBoard()),
    piece1: 'T',
    piece2: 'L',
    optimalLine: line,
    optimalMetrics: boardMetrics(board2),
    glicko: { rating: 1500, deviation: 350, volatility: 0.06 },
    colors: '',
    combos: { entries: [], total: 0 },
    acceptCount: null,
    margin: null,
    firstValues: [],
    secondValues: [],
  };
}

function makeDb(puzzle: Puzzle | null): PlayDb {
  const ratings = new Map<string, UserRating>();
  return {
    async getRandomPuzzle() {
      return puzzle;
    },
    async getUserRating(userId) {
      return ratings.get(userId) ?? null;
    },
    async upsertUserRating(rating) {
      ratings.set(rating.userId, rating);
      return rating;
    },
    async insertAttempt(attempt: NewAttempt): Promise<Attempt> {
      return {
        id: 'a1',
        createdAt: '2026-01-01T00:00:00Z',
        ratingAfter: attempt.ratingAfter ?? null,
        ...attempt,
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
