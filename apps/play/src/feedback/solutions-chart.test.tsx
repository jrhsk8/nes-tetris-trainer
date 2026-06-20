// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PlacementValue } from '@trainer/data';
import { SolutionsChart } from './SolutionsChart.js';

afterEach(() => cleanup());

// A small value table: the optimal (best) plus three weaker alternatives.
const values: PlacementValue[] = [
  { rotation: 0, col: 3, value: 30 }, // optimal (max)
  { rotation: 0, col: 0, value: 20 },
  { rotation: 1, col: 5, value: 10 }, // worst (min → 0 on the axis)
  { rotation: 0, col: 7, value: 25 },
];

describe('SolutionsChart (#29)', () => {
  it('plots one dot per alternative and marks the optimal at the top of the axis', () => {
    render(
      <SolutionsChart label="First piece (T)" values={values} optimal={{ rotation: 0, col: 3 }} />,
    );

    expect(screen.getAllByTestId('strip-dot')).toHaveLength(values.length);

    // The optimal dot is flagged and pinned at 100% of the axis.
    const optimal = screen.getByTestId('strip-dot-optimal');
    expect(optimal).toHaveStyle({ left: '100%' });
  });

  it('marks the player move and reports its rank as "Nth of M"', () => {
    render(
      <SolutionsChart
        label="First piece (T)"
        values={values}
        optimal={{ rotation: 0, col: 3 }}
        player={{ rotation: 0, col: 0 }} // value 20 → 3rd best of 4
      />,
    );

    const player = screen.getByTestId('strip-dot-player');
    expect(player).toBeInTheDocument();
    // value 20 is the 3rd-highest of the four → rank 3 of 4.
    expect(screen.getByTestId('strip-rank')).toHaveTextContent('3rd of 4');
  });

  it('reports rank 1 when the player matched the optimal placement', () => {
    render(
      <SolutionsChart
        label="First piece (T)"
        values={values}
        optimal={{ rotation: 0, col: 3 }}
        player={{ rotation: 0, col: 3 }}
      />,
    );
    expect(screen.getByTestId('strip-rank')).toHaveTextContent('1st of 4');
  });

  it('handles a player move that is not in the value table, gracefully', () => {
    render(
      <SolutionsChart
        label="First piece (T)"
        values={values}
        optimal={{ rotation: 0, col: 3 }}
        player={{ rotation: 3, col: 9 }} // not a ranked placement
      />,
    );
    expect(screen.queryByTestId('strip-dot-player')).not.toBeInTheDocument();
    expect(screen.getByTestId('strip-rank')).toHaveTextContent(/not among the 4/i);
  });
});
