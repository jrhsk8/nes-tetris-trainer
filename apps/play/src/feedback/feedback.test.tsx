// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyBoard, type ComboTable, type Grid, type Line } from '@trainer/core';
import { Feedback } from './Feedback.js';

afterEach(() => cleanup());

const L = (a: [number, number], b: [number, number]): Line => [
  { rotation: a[0], col: a[1] },
  { rotation: b[0], col: b[1] },
];

/** A combo table whose entries are the legal T-then-L placements on an empty board. */
function table(entries: ComboTable['entries'], total = entries.length): ComboTable {
  return { entries, total };
}

const rank1 = { rot1: 0, col1: 3, rot2: 0, col2: 6, score: 100 };

describe('Feedback verdict banner (#35)', () => {
  it('shows a Correct verdict with the combo score when the player plays the rank-1 combo', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table([rank1])}
        userLine={L([0, 3], [0, 6])}
      />,
    );
    const verdict = screen.getByTestId('verdict');
    expect(verdict).toHaveTextContent('Correct');
    expect(verdict).toHaveAttribute('data-correct', 'true');
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('A+ 100.0');
  });

  it('shows an Incorrect, "too low to rank" verdict when the combo is beyond the top-K', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table([rank1], 40)}
        userLine={L([0, 0], [0, 5])} // legal, but not among the stored entries
      />,
    );
    const verdict = screen.getByTestId('verdict');
    expect(verdict).toHaveTextContent('Incorrect');
    expect(verdict).toHaveAttribute('data-correct', 'false');
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('Too low to rank');
  });

  it('counts a ranked but sub-97 combo as Incorrect while still showing its grade (#60)', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table([rank1, { rot1: 1, col1: 0, rot2: 0, col2: 4, score: 80 }])}
        userLine={L([1, 0], [0, 4])}
      />,
    );
    expect(screen.getByTestId('verdict')).toHaveTextContent('Incorrect');
    // Letter grade + one decimal, no credit phrase (#60).
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('B- 80.0');
  });

  it('shows the A+ grade with one decimal for a near-best score (#60)', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table([{ ...rank1, score: 97.6 }])}
        userLine={L([0, 3], [0, 6])}
      />,
    );
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('A+ 97.6');
  });
});

describe('Feedback ranked combo list (#35)', () => {
  const six: ComboTable['entries'] = [
    rank1,
    { rot1: 0, col1: 1, rot2: 0, col2: 4, score: 90 },
    { rot1: 0, col1: 2, rot2: 0, col2: 5, score: 80 },
    { rot1: 0, col1: 4, rot2: 0, col2: 7, score: 70 },
    { rot1: 0, col1: 5, rot2: 0, col2: 8, score: 60 },
    { rot1: 0, col1: 6, rot2: 1, col2: 0, score: 50 }, // rank 6, not in the top-5
  ];

  it('lists exactly the top-5 combos with their scores', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table(six)}
        userLine={L([0, 3], [0, 6])}
      />,
    );
    expect(screen.getAllByTestId('combo-row')).toHaveLength(5);
    expect(screen.queryByTestId('combo-your-move')).toBeNull(); // player ranks 1st
  });

  it('highlights the player’s combo in-list when it ranks in the top-5', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table(six)}
        userLine={L([0, 2], [0, 5])} // rank 3
      />,
    );
    const rows = screen.getAllByTestId('combo-row');
    expect(rows[2]).toHaveTextContent('You');
    expect(rows[2]).toHaveClass('is-player');
    expect(screen.queryByTestId('combo-your-move')).toBeNull();
  });

  it('shows the player’s move below with its rank + score when it ranks beyond the top-5', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table(six)}
        userLine={L([0, 6], [1, 0])} // rank 6
      />,
    );
    const below = screen.getByTestId('combo-your-move');
    expect(below).toHaveTextContent('6th');
    expect(below).toHaveTextContent('F 50.0'); // letter + one decimal (#60)
  });

  it('shows "too low to rank" below when the player’s combo is unranked', () => {
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table(six, 40)}
        userLine={L([0, 0], [0, 5])}
      />,
    );
    expect(screen.getByTestId('combo-your-move')).toHaveTextContent('too low to rank');
  });

  it('selects a clicked combo row (the board replays it); the player’s move is default', async () => {
    const user = userEvent.setup();
    render(
      <Feedback
        board0={emptyBoard()}
        piece1="T"
        piece2="L"
        combos={table(six)}
        userLine={L([0, 2], [0, 5])} // rank 3 → its row is pressed by default
      />,
    );
    const rows = screen.getAllByTestId('combo-row');
    expect(rows[2]).toHaveAttribute('aria-pressed', 'true'); // player's move default
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false');

    await user.click(rows[0]);
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    expect(rows[2]).toHaveAttribute('aria-pressed', 'false');
  });
});

/** Run the whole replay timeline to its end under fake timers. */
function runReplay(stepMs: number): void {
  for (let i = 0; i < 12; i++) {
    act(() => void vi.advanceTimersByTime(stepMs));
  }
}

describe('Feedback replay animation of the selected combo', () => {
  it('drops a falling piece, then locks it into the stack and finishes settled', () => {
    vi.useFakeTimers();
    try {
      const board0: Grid = emptyBoard();
      render(
        <Feedback
          board0={board0}
          piece1="T"
          piece2="L"
          combos={table([rank1])}
          userLine={L([0, 3], [0, 6])}
          stepMs={50}
        />,
      );

      expect(screen.getByTestId('falling-piece')).toBeInTheDocument();
      expect(screen.getAllByTestId('falling-cell')).toHaveLength(4);
      expect(screen.getByTestId('falling-piece').style.transform).not.toBe('');

      runReplay(50);

      expect(screen.queryByTestId('falling-piece')).toBeNull();
      expect(document.querySelectorAll('[data-state="filled"]').length).toBeGreaterThan(0);
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
      render(
        <Feedback
          board0={emptyBoard()}
          piece1="T"
          piece2="L"
          combos={table([rank1])}
          userLine={L([0, 3], [0, 6])}
        />,
      );
      expect(screen.queryByTestId('falling-piece')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});
