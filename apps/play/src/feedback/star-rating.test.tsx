// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarRating, type StarDb } from './StarRating.js';

afterEach(() => cleanup());

/** A fake star-rating store: one row per (user, puzzle), upsertable. */
function makeDb(seed?: { stars?: number; others?: number[] }) {
  // rows keyed by user; `me` is the player, plus any seeded other ratings.
  const mine: { value: number | null } = { value: seed?.stars ?? null };
  const others = seed?.others ?? [];
  const calls: number[] = [];
  const db: StarDb = {
    async upsertStarRating(_userId, _puzzleId, stars) {
      calls.push(stars);
      mine.value = stars; // one row per user — re-rating overwrites
    },
    async getMyStarRating() {
      return mine.value;
    },
    async getStarStats() {
      const all = [...others, ...(mine.value != null ? [mine.value] : [])];
      const count = all.length;
      const avg = count ? all.reduce((a, b) => a + b, 0) / count : 0;
      return { avg, count };
    },
  };
  return { db, calls, mine };
}

describe('StarRating (#80)', () => {
  it('hides the community average until the player rates, then reveals it live', async () => {
    const { db } = makeDb({ stars: undefined, others: [5, 3] }); // two other ratings exist
    render(<StarRating db={db} userId="me" puzzleId="p1" />);

    // Prompt shows; community average is hidden until the player rates.
    expect(await screen.findByText(/How fun was this puzzle/)).toBeInTheDocument();
    expect(screen.queryByTestId('star-community')).toBeNull();

    // Rate 4 stars → reveal the live average INCLUDING this rating: (5+3+4)/3 = 4.0 (3).
    await userEvent.click(screen.getByTestId('star-4'));
    const community = await screen.findByTestId('star-community');
    expect(community).toHaveTextContent('4.0 ★ (3)');
  });

  it('upserts one rating per user — re-rating updates the same row', async () => {
    const { db, calls, mine } = makeDb({ stars: undefined, others: [] });
    render(<StarRating db={db} userId="me" puzzleId="p1" />);
    await screen.findByText(/How fun/);

    await userEvent.click(screen.getByTestId('star-5'));
    await waitFor(() => expect(screen.getByTestId('star-community')).toHaveTextContent('5.0 ★ (1)'));

    // Change the mind: re-rate 2. Still ONE row (count stays 1), value updated.
    await userEvent.click(screen.getByTestId('star-2'));
    await waitFor(() => expect(screen.getByTestId('star-community')).toHaveTextContent('2.0 ★ (1)'));

    expect(calls).toEqual([5, 2]); // two upserts, same row
    expect(mine.value).toBe(2);
  });

  it('reveals the community average immediately for an already-rated puzzle', async () => {
    // Seeded: the player already rated this puzzle 4; one other rated 2.
    const { db } = makeDb({ stars: 4, others: [2] });
    render(<StarRating db={db} userId="me" puzzleId="p1" />);
    // No click needed — having a prior rating reveals the average: (4+2)/2 = 3.0 (2).
    expect(await screen.findByTestId('star-community')).toHaveTextContent('3.0 ★ (2)');
  });
});
