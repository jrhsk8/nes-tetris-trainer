// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { perTypeStats } from './perTypeStats.js';
import { PerTypeStats } from './PerTypeStats.js';

afterEach(() => cleanup());

describe('perTypeStats (#86 aggregation)', () => {
  it('aggregates per-tag solve-rate, counting multi-tag puzzles toward each tag', () => {
    const stats = perTypeStats([
      { tags: ['tuck', 'spin'], solved: true }, // counts toward tuck AND spin
      { tags: ['tuck'], solved: false },
      { tags: ['spin'], solved: true },
      { tags: ['burn'], solved: true },
    ]);
    const by = Object.fromEntries(stats.map((s) => [s.tag, s]));
    // tuck: 2 attempts (one multi-tag), 1 solved -> 0.5
    expect(by['tuck']).toMatchObject({ attempts: 2, solved: 1, solveRate: 0.5 });
    // spin: 2 attempts, both solved -> 1
    expect(by['spin']).toMatchObject({ attempts: 2, solved: 2, solveRate: 1 });
    // burn: 1 attempt, solved -> 1
    expect(by['burn']).toMatchObject({ attempts: 1, solved: 1, solveRate: 1 });
  });

  it('sorts weakest first (lowest solve-rate, then more attempts)', () => {
    const stats = perTypeStats([
      { tags: ['burn'], solved: true },
      { tags: ['tuck'], solved: false },
      { tags: ['tuck'], solved: true },
      { tags: ['dig'], solved: false },
    ]);
    // dig 0% then tuck 50% then burn 100%.
    expect(stats.map((s) => s.tag)).toEqual(['dig', 'tuck', 'burn']);
  });

  it('ignores attempts with no tags', () => {
    expect(perTypeStats([{ tags: [], solved: true }])).toEqual([]);
  });
});

describe('PerTypeStats panel (#86)', () => {
  it('renders a weakest-first table for a player with rated attempts', () => {
    render(
      <PerTypeStats
        attempts={[
          { tags: ['tuck'], solved: false },
          { tags: ['burn'], solved: true },
        ]}
      />,
    );
    expect(screen.getByTestId('per-type-stats')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    // Weakest (tuck, 0%) first.
    expect(rows[0]).toHaveAttribute('data-tag', 'tuck');
    expect(rows[0]).toHaveTextContent('0%');
  });

  it('shows a zero state for a player with no attempts', () => {
    render(<PerTypeStats attempts={[]} />);
    expect(screen.getByTestId('per-type-empty')).toBeInTheDocument();
  });
});
