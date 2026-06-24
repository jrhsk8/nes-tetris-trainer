// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyPlacement, boardMetrics, emptyBoard, encodeBoard, type Line, type PuzzleTag } from '@trainer/core';
import type { Puzzle } from '@trainer/data';
import { DrillMode } from './DrillMode.js';
import type { PlayDb } from '../session/index.js';
import { TAG_VOCAB } from './tagVocab.js';

afterEach(() => cleanup());

function samplePuzzle(tags: PuzzleTag[]): Puzzle {
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
    tags,
    acceptCount: null,
    margin: null,
    firstValues: [],
    secondValues: [],
  };
}

/** A PlayDb that records the tag set drill mode requested. */
function drillDb() {
  const requested: PuzzleTag[][] = [];
  const db = {
    async fetchPuzzlesByTags(tags: readonly PuzzleTag[]) {
      requested.push([...tags]);
      return [samplePuzzle([...tags])];
    },
    async getMatchmadePuzzle() {
      return null;
    },
    async getPuzzleByNumber() {
      return null;
    },
    async getRecentAttemptedPuzzleIds() {
      return [];
    },
    async getUserRating() {
      return null;
    },
    async upsertUserRating(r: never) {
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
    async insertAttempt() {
      throw new Error('drill must not write attempts');
    },
  } as unknown as PlayDb;
  return { db, requested };
}

describe('DrillMode (#85)', () => {
  it('Start is disabled until at least one type is selected', async () => {
    const user = userEvent.setup();
    const { db } = drillDb();
    render(<DrillMode db={db} userId="u1" />);

    const start = screen.getByRole('button', { name: /start drilling/i });
    expect(start).toBeDisabled();
    await user.click(screen.getByRole('button', { name: TAG_VOCAB['tuck'].label }));
    expect(start).toBeEnabled();
  });

  it('serves drill puzzles matching ANY selected type (OR overlap)', async () => {
    const user = userEvent.setup();
    const { db, requested } = drillDb();
    render(<DrillMode db={db} userId="u1" />);

    await user.click(screen.getByRole('button', { name: TAG_VOCAB['tuck'].label }));
    await user.click(screen.getByRole('button', { name: TAG_VOCAB['burn'].label }));
    await user.click(screen.getByRole('button', { name: /start drilling/i }));

    // Switched into the unrated-practice play surface…
    expect(await screen.findByTestId('drill-play')).toBeInTheDocument();
    // …requesting the OR set of the two selected tags.
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(new Set(requested[0])).toEqual(new Set(['tuck', 'burn']));
  });

  it('lets the player change types (back to the picker)', async () => {
    const user = userEvent.setup();
    const { db } = drillDb();
    render(<DrillMode db={db} userId="u1" />);

    await user.click(screen.getByRole('button', { name: TAG_VOCAB['spin'].label }));
    await user.click(screen.getByRole('button', { name: /start drilling/i }));
    expect(await screen.findByTestId('drill-play')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /change types/i }));
    expect(screen.getByTestId('drill-picker')).toBeInTheDocument();
  });
});
