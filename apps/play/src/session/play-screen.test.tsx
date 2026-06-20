// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { applyPlacement, boardMetrics, emptyBoard, encodeBoard, type Line } from '@trainer/core';
import type { Puzzle } from '@trainer/data';
import { PuzzleSession, type SessionDb } from './PuzzleSession.js';

afterEach(() => cleanup());

function makePuzzle(): Puzzle {
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
  };
}

const noopDb: SessionDb = {
  async getUserRating() {
    return null;
  },
  async upsertUserRating(r) {
    return { userId: r.userId, rating: 1500, deviation: 200, volatility: 0.06 };
  },
  async insertAttempt() {
    throw new Error('not used');
  },
};

describe('Play screen flanking layout (#22)', () => {
  it('renders the board in the centre with the rating rail on the left and the next box on the right', () => {
    render(
      <PuzzleSession
        puzzle={makePuzzle()}
        userId="u1"
        db={noopDb}
        leftFlank={<div data-testid="rating-rail">rating</div>}
      />,
    );

    // The supplied left flank is placed in the left rail.
    const leftRail = screen.getByRole('complementary', { name: 'rating rail' });
    expect(leftRail).toContainElement(screen.getByTestId('rating-rail'));

    // The board sits in the centre column.
    const center = screen.getByTestId('board-center');
    expect(center).toContainElement(screen.getByRole('grid', { name: 'board' }));

    // The next piece is shown in the right flank during placement 1.
    const rightRail = screen.getByRole('complementary', { name: 'next piece' });
    expect(rightRail).toContainElement(screen.getByTestId('next-piece'));
  });
});
