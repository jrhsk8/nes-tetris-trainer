// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { applyPlacement, emptyBoard, type Grid, type Line } from '@trainer/core';
import type { PlacementValue } from '@trainer/data';
import { Feedback } from './Feedback.js';

afterEach(() => cleanup());

const optimalLine: Line = [
  { rotation: 0, col: 3 },
  { rotation: 0, col: 6 },
];

// Sample value tables: the optimal placement is the highest-valued entry.
const firstValues: PlacementValue[] = [
  { rotation: optimalLine[0].rotation, col: optimalLine[0].col, value: 30 },
  { rotation: 0, col: 0, value: 20 },
  { rotation: 0, col: 9, value: 10 },
];
const secondValues: PlacementValue[] = [
  { rotation: optimalLine[1].rotation, col: optimalLine[1].col, value: 25 },
  { rotation: 0, col: 1, value: 12 },
];

function filledCount(): number {
  return document.querySelectorAll('[data-state="filled"]').length;
}

describe('Feedback solutions chart (#29)', () => {
  it('replaces the old geometric-metrics table with per-piece solution charts', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        optimalLine={optimalLine}
        firstValues={firstValues}
        secondValues={secondValues}
        userLine={[
          { rotation: 0, col: 0 }, // a non-optimal first move (value 20 → 2nd of 3)
        ]}
      />,
    );

    // The old metrics table is gone.
    expect(screen.queryByTestId('metric-holes')).toBeNull();
    expect(document.querySelector('.metric-deltas')).toBeNull();

    // The piece-1 distribution is always shown, with the player's rank.
    const charts = screen.getAllByTestId('solutions-chart');
    expect(charts).toHaveLength(1); // piece-2 omitted: the player never reached it
    expect(screen.getByTestId('strip-rank')).toHaveTextContent('2nd of 3');
    expect(screen.getAllByTestId('strip-dot')).toHaveLength(firstValues.length);
  });

  it('shows the piece-2 distribution once the player reached placement 2', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        optimalLine={optimalLine}
        firstValues={firstValues}
        secondValues={secondValues}
        userLine={optimalLine} // both moves optimal → both charts, both rank 1st
      />,
    );

    const charts = screen.getAllByTestId('solutions-chart');
    expect(charts).toHaveLength(2);
    const ranks = screen.getAllByTestId('strip-rank');
    expect(ranks[0]).toHaveTextContent('1st of 3');
    expect(ranks[1]).toHaveTextContent('1st of 2');
  });
});

/** Run the whole replay timeline to its end under fake timers. */
function runReplay(stepMs: number): void {
  // Generous bound: far more steps than any two-ply replay produces.
  for (let i = 0; i < 12; i++) {
    act(() => void vi.advanceTimersByTime(stepMs));
  }
}

describe('Feedback replay animation of the optimal line', () => {
  it('drops a falling piece, then locks it into the stack and finishes settled', () => {
    vi.useFakeTimers();
    try {
      const board0: Grid = emptyBoard();
      render(
        <Feedback
          board0={board0}
          piece1="T"
          piece2="L"
          optimalLine={optimalLine}
          firstValues={firstValues}
          secondValues={secondValues}
          userLine={optimalLine}
          stepMs={50}
        />,
      );

      // First frame: piece 1 is a falling overlay (4 cells), stack still empty.
      expect(screen.getByTestId('falling-piece')).toBeInTheDocument();
      expect(screen.getAllByTestId('falling-cell')).toHaveLength(4);
      const empty = filledCount();

      // The falling overlay moves via a CSS transform (GPU motion).
      expect(screen.getByTestId('falling-piece').style.transform).not.toBe('');

      runReplay(50);

      // Settled: both pieces are part of the static stack; nothing still falling.
      expect(screen.queryByTestId('falling-piece')).toBeNull();
      expect(filledCount()).toBeGreaterThan(empty);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flashes and collapses when the optimal line clears a row', () => {
    vi.useFakeTimers();
    try {
      // A board one O-piece away from completing the bottom two rows: columns
      // 0..7 filled on rows 18-19, leaving the 2x2 well at columns 8-9.
      const board0: Grid = emptyBoard();
      for (let c = 0; c < 8; c++) {
        board0[18][c] = 1;
        board0[19][c] = 1;
      }
      const line: Line = [
        { rotation: 0, col: 8 },
        { rotation: 0, col: 0 },
      ];
      render(
        <Feedback
          board0={board0}
          piece1="O"
          piece2="O"
          optimalLine={line}
          firstValues={firstValues}
          secondValues={secondValues}
          userLine={line}
          stepMs={50}
        />,
      );

      // Step until the flash frame appears.
      let sawFlash = false;
      for (let i = 0; i < 12 && !sawFlash; i++) {
        if (screen.queryByTestId('line-flash')) sawFlash = true;
        else act(() => void vi.advanceTimersByTime(50));
      }
      expect(sawFlash).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('snaps to the settled board with reduced motion (no falling piece)', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const board0: Grid = emptyBoard();
      render(
        <Feedback
          board0={board0}
          piece1="T"
          piece2="L"
          optimalLine={optimalLine}
          firstValues={firstValues}
          secondValues={secondValues}
          userLine={optimalLine}
        />,
      );
      // No animation: the board is already fully settled and nothing falls.
      expect(screen.queryByTestId('falling-piece')).toBeNull();
      const settled = applyPlacement(
        applyPlacement(board0, 'T', optimalLine[0]),
        'L',
        optimalLine[1],
      );
      const expectedFilled = settled.flat().filter(Boolean).length;
      expect(filledCount()).toBe(expectedFilled);
    } finally {
      window.matchMedia = original;
    }
  });
});
