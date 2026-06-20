// @vitest-environment jsdom
import { describe, it, expect, afterAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Placement } from '@trainer/core';
import { createDataAccess, createSupabaseClient, type Puzzle } from '@trainer/data';
import { PuzzleSession } from './PuzzleSession.js';

// Deep play-flow interaction test (#14, PRD Testing surface 1): from a REAL
// stored puzzle, drive the whole loop — present → place → place → grade →
// rating → feedback — and assert the observable outcomes, including persistence
// read back through the data layer. Uses the service-role client (bypasses RLS)
// and a throwaway user id; skipped when Supabase env is absent.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const configured = Boolean(url && serviceKey);
const db = configured ? createDataAccess(createSupabaseClient(url!, serviceKey!)) : null;

const userId = configured ? crypto.randomUUID() : '';

afterAll(async () => {
  cleanup();
  if (!configured) return;
  const client = createSupabaseClient(url!, serviceKey!);
  await client.from('attempts').delete().eq('user_id', userId);
  await client.from('user_ratings').delete().eq('user_id', userId);
});

/** Drive the on-screen ghost to `target` and confirm. */
async function place(user: ReturnType<typeof userEvent.setup>, target: Placement) {
  const input = () => screen.getByLabelText('placement input');
  for (let i = 0; i < 8 && Number(input().getAttribute('data-rotation')) !== target.rotation; i++) {
    await user.click(screen.getByRole('button', { name: 'Rotate clockwise' }));
  }
  for (let i = 0; i < 20 && Number(input().getAttribute('data-col')) !== target.col; i++) {
    const current = Number(input().getAttribute('data-col'));
    await user.click(
      screen.getByRole('button', { name: current < target.col ? 'Move right' : 'Move left' }),
    );
  }
  await user.click(screen.getByRole('button', { name: 'Confirm placement' }));
}

describe.skipIf(!configured)('Play flow (deep, real stored puzzle)', () => {
  it('plays the optimal line of a stored puzzle to a solved outcome, persists, and shows feedback', async () => {
    const puzzle: Puzzle | null = await db!.getRandomPuzzle();
    expect(puzzle).not.toBeNull();
    if (!puzzle) return;

    const user = userEvent.setup();
    render(<PuzzleSession puzzle={puzzle} userId={userId} db={db!} />);

    // Present: the board with the current and next piece.
    expect(screen.getByTestId('next-piece')).toHaveTextContent(puzzle.piece2);

    // Place the optimal first and second moves.
    await place(user, puzzle.optimalLine[0]);
    await place(user, puzzle.optimalLine[1]);

    // Grade + rating: solved, rating went up.
    expect(await screen.findByTestId('outcome')).toHaveTextContent('Solved!');
    expect(screen.getByTestId('rating-change')).toHaveTextContent('(+');

    // Feedback: the optimal line animates and the metric deltas are zero
    // (the player played the optimal line), with no engine call.
    expect(screen.getByTestId('feedback-step')).toBeInTheDocument();
    expect(screen.getByTestId('delta-holes')).toHaveTextContent('0');
    expect(screen.getByTestId('delta-bumpiness')).toHaveTextContent('0');
    expect(screen.getByTestId('delta-aggregateHeight')).toHaveTextContent('0');

    // Persistence: the attempt and the raised rating round-trip through the DAL.
    await waitFor(async () => {
      const attempts = await db!.getUserAttempts(userId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].solved).toBe(true);
    });
    const rating = await db!.getUserRating(userId);
    expect(rating!.rating).toBeGreaterThan(1500);
  }, 30_000);
});
