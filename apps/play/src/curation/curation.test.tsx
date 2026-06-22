// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Curation, type CurationDb } from './Curation.js';

afterEach(() => cleanup());

function db(overrides: Partial<CurationDb> = {}): CurationDb {
  return {
    async isCurator() {
      return true;
    },
    async flagPuzzle() {},
    async cullPuzzle() {},
    async setPuzzleActive() {},
    ...overrides,
  };
}

describe('Dev in-play curation (#72)', () => {
  it('renders nothing for a non-curator (empty-safe default)', async () => {
    const { container } = render(
      <Curation db={db({ isCurator: async () => false })} userId="u1" puzzleId="p1" />,
    );
    // No controls appear; the block has no presence for ordinary players.
    await waitFor(() => expect(container.querySelector('.curation')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Flag' })).toBeNull();
  });

  it('reveals Flag + Cull for an allowlisted curator', async () => {
    render(<Curation db={db()} userId="u1" puzzleId="p1" />);
    expect(await screen.findByRole('button', { name: 'Flag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cull' })).toBeInTheDocument();
  });

  it('flags with a free-text comment', async () => {
    const user = userEvent.setup();
    const flagPuzzle = vi.fn(async () => {});
    render(<Curation db={db({ flagPuzzle })} userId="u1" puzzleId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Flag' }));
    await user.type(screen.getByLabelText('flag comment'), 'too easy, obvious well');
    await user.click(screen.getByRole('button', { name: 'Save flag' }));

    expect(flagPuzzle).toHaveBeenCalledWith({
      puzzleId: 'p1',
      userId: 'u1',
      comment: 'too easy, obvious well',
    });
    expect(await screen.findByText('Flagged.')).toBeInTheDocument();
  });

  it('culls (soft-delete) and offers an Undo that restores it', async () => {
    const user = userEvent.setup();
    const cullPuzzle = vi.fn(async () => {});
    const setPuzzleActive = vi.fn(async () => {});
    render(<Curation db={db({ cullPuzzle, setPuzzleActive })} userId="u1" puzzleId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Cull' }));
    expect(cullPuzzle).toHaveBeenCalledWith({ puzzleId: 'p1', userId: 'u1', reason: undefined });

    // The undo toast appears and restores the puzzle.
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undo);
    expect(setPuzzleActive).toHaveBeenCalledWith('p1', true);
  });
});
