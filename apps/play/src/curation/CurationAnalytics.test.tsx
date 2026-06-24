// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { CurationTagStat } from '@trainer/data';
import { CurationAnalytics, type CurationAnalyticsDb } from './CurationAnalytics.js';

afterEach(() => cleanup());

const STATS: CurationTagStat[] = [
  { tag: 'spin', puzzleCount: 10, flagCount: 6, cullCount: 3, avgStars: 2.4, ratingCount: 8 },
  { tag: 'clean-stacking', puzzleCount: 20, flagCount: 1, cullCount: 0, avgStars: 4.1, ratingCount: 12 },
];

function db(over: Partial<CurationAnalyticsDb> = {}): CurationAnalyticsDb {
  return {
    isAdmin: vi.fn(async () => true),
    getCurationTagStats: vi.fn(async () => STATS),
    ...over,
  };
}

describe('CurationAnalytics curator-only reveal (#87)', () => {
  it('renders a per-tag table for an admin (flag/cull rate + avg stars)', async () => {
    render(<CurationAnalytics db={db()} />);

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'curation analytics by type' })).toBeInTheDocument(),
    );

    // The 'spin' row shows the rate (flags/puzzles = 6/10 = 0.60, culls 3/10 = 0.30)
    // and avg stars, so the curator can see spin puzzles underperform.
    const spin = screen.getByTestId('tag-stat-spin');
    expect(spin).toHaveTextContent('Spin'); // the display label, not the raw tag
    expect(spin).toHaveTextContent('0.60'); // flag rate
    expect(spin).toHaveTextContent('0.30'); // cull rate
    expect(spin).toHaveTextContent('2.4'); // avg stars

    // The cleaner type is also present with its own (better) numbers.
    expect(screen.getByTestId('tag-stat-clean-stacking')).toHaveTextContent('Clean stacking');
  });

  it('renders NOTHING for a non-admin and never fetches the stats (#87 gate)', async () => {
    const getCurationTagStats = vi.fn(async () => STATS);
    const { container } = render(
      <CurationAnalytics db={db({ isAdmin: vi.fn(async () => false), getCurationTagStats })} />,
    );

    // Give the effect a tick to resolve isAdmin → false.
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(container).toBeEmptyDOMElement();
    // A non-admin never even reads the aggregate.
    expect(getCurationTagStats).not.toHaveBeenCalled();
  });

  it('shows a zero state when there are no tagged puzzles yet', async () => {
    render(<CurationAnalytics db={db({ getCurationTagStats: vi.fn(async () => []) })} />);
    await waitFor(() => expect(screen.getByText('No tagged puzzles yet.')).toBeInTheDocument());
  });
});
