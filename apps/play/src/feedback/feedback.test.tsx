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

describe('Feedback animation of the optimal line', () => {
  it('steps through the two-ply line, growing the stack each step', () => {
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
          stepMs={100}
        />,
      );

      expect(screen.getByTestId('feedback-step')).toHaveTextContent('Step 1 of 3');
      const empty = filledCount();

      act(() => void vi.advanceTimersByTime(100));
      expect(screen.getByTestId('feedback-step')).toHaveTextContent('Step 2 of 3');
      const afterPly1 = filledCount();
      expect(afterPly1).toBeGreaterThan(empty);

      act(() => void vi.advanceTimersByTime(100));
      expect(screen.getByTestId('feedback-step')).toHaveTextContent('Step 3 of 3');
      expect(filledCount()).toBeGreaterThan(afterPly1);
    } finally {
      vi.useRealTimers();
    }
  });
});
