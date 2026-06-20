// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  applyPlacement,
  boardMetrics,
  emptyBoard,
  type BoardMetrics,
  type Grid,
  type Line,
} from '@trainer/core';
import { Feedback } from './Feedback.js';

afterEach(() => cleanup());

const optimalLine: Line = [
  { rotation: 0, col: 3 },
  { rotation: 0, col: 6 },
];

function filledCount(): number {
  return document.querySelectorAll('[data-state="filled"]').length;
}

describe('Feedback metric deltas', () => {
  it('computes the player-side metrics client-side and shows deltas vs optimal', () => {
    const board0 = emptyBoard();
    const userLine: Line = [
      { rotation: 0, col: 0 },
      { rotation: 0, col: 2 },
    ];
    // Expected player metrics are exactly boardMetrics of the player's result.
    const userResult = applyPlacement(applyPlacement(board0, 'O', userLine[0]), 'O', userLine[1]);
    const expected = boardMetrics(userResult);

    // A deliberately different "optimal" so the deltas are non-trivial.
    const optimalMetrics: BoardMetrics = {
      columnHeights: new Array(10).fill(0),
      aggregateHeight: 0,
      bumpiness: 0,
      holes: 0,
    };

    render(
      <Feedback
        board0={board0}
        piece1="O"
        piece2="O"
        optimalLine={optimalLine}
        optimalMetrics={optimalMetrics}
        userLine={userLine}
      />,
    );

    expect(screen.getByTestId('metric-holes')).toHaveTextContent(String(expected.holes));
    expect(screen.getByTestId('metric-aggregateHeight')).toHaveTextContent(
      String(expected.aggregateHeight),
    );
    // Delta = player - optimal; here optimal is all-zero, so delta equals player.
    expect(screen.getByTestId('delta-aggregateHeight')).toHaveTextContent(
      `+${expected.aggregateHeight}`,
    );
  });

  it('shows zero deltas when the player played the optimal line', () => {
    const board0 = emptyBoard();
    const board2 = applyPlacement(applyPlacement(board0, 'T', optimalLine[0]), 'L', optimalLine[1]);
    render(
      <Feedback
        board0={board0}
        piece1="T"
        piece2="L"
        optimalLine={optimalLine}
        optimalMetrics={boardMetrics(board2)}
        userLine={optimalLine}
      />,
    );
    expect(screen.getByTestId('delta-holes')).toHaveTextContent('0');
    expect(screen.getByTestId('delta-bumpiness')).toHaveTextContent('0');
    expect(screen.getByTestId('delta-aggregateHeight')).toHaveTextContent('0');
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
      const board2 = applyPlacement(
        applyPlacement(board0, 'T', optimalLine[0]),
        'L',
        optimalLine[1],
      );
      render(
        <Feedback
          board0={board0}
          piece1="T"
          piece2="L"
          optimalLine={optimalLine}
          optimalMetrics={boardMetrics(board2)}
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
      const final = applyPlacement(applyPlacement(board0, 'O', line[0]), 'O', line[1]);
      render(
        <Feedback
          board0={board0}
          piece1="O"
          piece2="O"
          optimalLine={line}
          optimalMetrics={boardMetrics(final)}
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
      const board2 = applyPlacement(
        applyPlacement(board0, 'T', optimalLine[0]),
        'L',
        optimalLine[1],
      );
      render(
        <Feedback
          board0={board0}
          piece1="T"
          piece2="L"
          optimalLine={optimalLine}
          optimalMetrics={boardMetrics(board2)}
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
