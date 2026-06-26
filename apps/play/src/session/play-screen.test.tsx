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

const noopDb: SessionDb = {
  async getUserRating() {
    return null;
  },
  async upsertUserRating(r) {
    return { userId: r.userId, rating: 1500, deviation: 200, volatility: 0.06 };
  },
  async updatePuzzleRating() {},
  async insertAttempt() {
    throw new Error('not used');
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

describe('Authentic stack colours (#28)', () => {
  it('renders the stored colour grid: a filled stack cell shows its NES colour group', () => {
    // A board with one filled cell at row 19, col 0, coloured group 2 (Z/L red).
    const board = '0'.repeat(190) + '1' + '0'.repeat(9);
    const colors = '0'.repeat(190) + '2' + '0'.repeat(9);
    const puzzle: Puzzle = { ...makePuzzle(), board, colors };

    render(<PuzzleSession puzzle={puzzle} userId="u1" db={noopDb} />);

    const cell = screen.getByTestId('cell-19-0');
    expect(decodeURIComponent(cell.style.backgroundImage)).toContain('#d82800');
  });
});

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
