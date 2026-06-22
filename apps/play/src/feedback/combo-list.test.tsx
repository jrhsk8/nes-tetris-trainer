// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComboEntry, Line } from '@trainer/core';
import { ComboList } from './ComboList.js';

afterEach(() => cleanup());

const five: ComboEntry[] = [
  { rot1: 0, col1: 3, rot2: 0, col2: 6, score: 100 },
  { rot1: 0, col1: 1, rot2: 0, col2: 4, score: 90 },
  { rot1: 0, col1: 2, rot2: 0, col2: 5, score: 80 },
  { rot1: 0, col1: 4, rot2: 0, col2: 7, score: 70 },
  { rot1: 0, col1: 5, rot2: 0, col2: 8, score: 60 },
];
const selected: Line = [
  { rotation: 0, col: 3 },
  { rotation: 0, col: 6 },
];

describe('ComboList compact mobile mode (#70)', () => {
  it('shows the full top-5 by default (desktop)', () => {
    render(
      <ComboList
        entries={five}
        total={5}
        userLine={[]}
        playerRank={null}
        playerScore={null}
        selected={selected}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('combo-row')).toHaveLength(5);
    expect(screen.queryByTestId('combo-more')).toBeNull();
  });

  it('collapses to the top ranks with a "More" expand when compact', async () => {
    const user = userEvent.setup();
    render(
      <ComboList
        entries={five}
        total={5}
        userLine={[]}
        playerRank={null}
        playerScore={null}
        selected={selected}
        onSelect={vi.fn()}
        compact
      />,
    );
    // Collapsed: only the very top ranks, zero scroll; the rest behind "More".
    expect(screen.getAllByTestId('combo-row')).toHaveLength(3);
    const more = screen.getByTestId('combo-more');
    expect(more).toHaveTextContent('More (2)');

    await user.click(more);
    expect(screen.getAllByTestId('combo-row')).toHaveLength(5);
    expect(screen.queryByTestId('combo-more')).toBeNull();
  });

  it('keeps the player’s own ranked row visible even while collapsed', () => {
    // Player ranks 5th — beyond the default compact cut — but their row must
    // still show so they never lose sight of where their answer landed.
    render(
      <ComboList
        entries={five}
        total={5}
        userLine={[
          { rotation: 0, col: 5 },
          { rotation: 0, col: 8 },
        ]}
        playerRank={5}
        playerScore={60}
        selected={selected}
        onSelect={vi.fn()}
        compact
      />,
    );
    const rows = screen.getAllByTestId('combo-row');
    expect(rows).toHaveLength(5);
    expect(rows[4]).toHaveClass('is-player');
  });
});
