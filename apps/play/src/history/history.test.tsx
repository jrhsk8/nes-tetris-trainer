// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { boardMetrics, emptyBoard, encodeBoard, type Line } from '@trainer/core';
import type { AttemptHistoryEntry, Puzzle } from '@trainer/data';
import { History, type HistoryDb } from './History.js';

afterEach(() => cleanup());

const line: Line = [
  { rotation: 0, col: 3 },
  { rotation: 0, col: 6 },
];

function entry(over: Partial<AttemptHistoryEntry> & { id: string }): AttemptHistoryEntry {
  return {
    userId: 'u1',
    puzzleId: `p-${over.id}`,
    userLine: line,
    solved: false,
    ratingAfter: 1500,
    createdAt: '2026-06-01T00:00:00.000Z',
    difficulty: 1500,
    ...over,
  };
}

function makeDb(entries: AttemptHistoryEntry[], puzzle?: Puzzle | null): HistoryDb {
  return {
    async getUserAttemptHistory() {
      return entries;
    },
    async getPuzzle() {
      return puzzle ?? null;
    },
  };
}

function samplePuzzle(): Puzzle {
  return {
    id: 'p-a',
    board: encodeBoard(emptyBoard()),
    piece1: 'T',
    piece2: 'L',
    optimalLine: line,
    optimalMetrics: boardMetrics(emptyBoard()),
    glicko: { rating: 1500, deviation: 200, volatility: 0.06 },
    colors: '',
    combos: { entries: [], total: 0 },
    acceptCount: null,
    margin: null,
    firstValues: [],
    secondValues: [],
  };
}

describe('History view', () => {
  it('lists attempts newest-first and filters by result', async () => {
    const user = userEvent.setup();
    const db = makeDb([
      entry({ id: 'a', createdAt: '2026-06-01T00:00:00.000Z', solved: true }),
      entry({ id: 'b', createdAt: '2026-06-03T00:00:00.000Z', solved: false }),
    ]);
    render(<History db={db} userId="u1" />);

    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(2));
    // Newest (June 3, failed) first by default.
    const rows = screen.getAllByTestId('history-row');
    expect(within(rows[0]).getByTestId('history-result')).toHaveTextContent('Failed');

    // Filter to solved-only.
    await user.selectOptions(screen.getByLabelText('Filter by result'), 'solved');
    const solvedRows = screen.getAllByTestId('history-row');
    expect(solvedRows).toHaveLength(1);
    expect(within(solvedRows[0]).getByTestId('history-result')).toHaveTextContent('Solved');
  });

  it('sorts by difficulty when that column is toggled', async () => {
    const user = userEvent.setup();
    const db = makeDb([
      entry({ id: 'lo', difficulty: 1200 }),
      entry({ id: 'hi', difficulty: 1800 }),
    ]);
    render(<History db={db} userId="u1" />);
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(2));

    // Click Difficulty → desc first (highest at top).
    await user.click(screen.getByRole('button', { name: /Difficulty/ }));
    let rows = screen.getAllByTestId('history-row');
    expect(rows[0]).toHaveTextContent('1800');

    // Toggle → asc (lowest at top).
    await user.click(screen.getByRole('button', { name: /Difficulty/ }));
    rows = screen.getAllByTestId('history-row');
    expect(rows[0]).toHaveTextContent('1200');
  });

  it('paginates when there are more than a page of attempts', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 10 }, (_, i) =>
      entry({
        id: String(i),
        createdAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    render(<History db={makeDb(many)} userId="u1" />);
    await waitFor(() =>
      expect(screen.getByTestId('history-page')).toHaveTextContent('Page 1 of 2'),
    );

    expect(screen.getAllByTestId('history-row')).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('history-page')).toHaveTextContent('Page 2 of 2');
    expect(screen.getAllByTestId('history-row')).toHaveLength(2);
  });

  it('re-opens an attempt read-only in the feedback view', async () => {
    const user = userEvent.setup();
    const db = makeDb([entry({ id: 'a', puzzleId: 'p-a', solved: true })], samplePuzzle());
    render(<History db={db} userId="u1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Review attempt' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Review attempt' }));
    // The Feedback view renders its board centre + a back button.
    await waitFor(() => expect(screen.getByTestId('board-center')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Back to history/ })).toBeInTheDocument();
  });

  it('shows orphaned attempts but does not let them be reopened', async () => {
    const db = makeDb([entry({ id: 'gone', difficulty: null })]);
    render(<History db={db} userId="u1" />);
    await waitFor(() => expect(screen.getByTestId('history-row')).toBeInTheDocument());
    const review = screen.getByRole('button', { name: 'Review attempt' });
    expect(review).toBeDisabled();
    expect(review).toHaveAttribute('title');
  });
});
