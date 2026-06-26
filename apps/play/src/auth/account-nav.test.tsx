// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthApi } from './auth.js';
import { Account, type AccountDb } from './Account.js';

afterEach(() => cleanup());

function fakeAuth(): AuthApi {
  return {
    currentUser: vi.fn(async () => null),
    ensureAnonymousSession: vi.fn(async () => null),
    continueAsGuest: vi.fn(async () => ({ id: 'guest', email: null, isAnonymous: true })),
    onChange: vi.fn(() => () => {}),
    signInWithEmail: vi.fn(async () => {}),
    signUpWithEmail: vi.fn(async () => {}),
    signInWithProvider: vi.fn(async () => {}),
    linkEmail: vi.fn(async () => {}),
    linkWithProvider: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  };
}

/** A minimal db with an empty bank (the Play view short-circuits). */
function emptyDb(): AccountDb {
  return {
    async getUserAttempts() {
      return [];
    },
    async getPuzzleSolveStats() {
      return { total: 0, solved: 0 };
    },
    async upsertStarRating() {},
    async getMyStarRating() {
      return null;
    },
    async getStarStats() {
      return { avg: 0, count: 0 };
    },
    async getMissPuzzleIds() {
      return [];
    },
    async isAdmin() {
      return false;
    },
    async flagPuzzle() {},
    async cullPuzzle() {},
    async setPuzzleActive() {},
    async getCurationTagStats() { return []; },
    async getUserRating() {
      return null;
    },
    async getMatchmadePuzzle() {
      return null;
    },
    async fetchPuzzlesByTags() {
      return [];
    },
    async getPuzzleByNumber() {
      return null;
    },
    async getRecentAttemptedPuzzleIds() {
      return [];
    },
    async upsertUserRating(r) {
      return { userId: r.userId, rating: 1500, deviation: 200, volatility: 0.06 };
    },
    async updatePuzzleRating() {},
    async insertAttempt() {
      throw new Error('not used');
    },
    async getUserAttemptHistory() {
      return [];
    },
    async getPuzzle() {
      return null;
    },
    async getUserPrefs() {
      return null;
    },
    async upsertUserPrefs(p) {
      return p;
    },
    async uploadSubmissionImage() { return ""; },
    async insertSubmission(s) {
      return {
        id: 'sub-1',
        imagePath: s.imagePath,
        submitter: s.submitter,
        status: 'pending',
        reason: null,
        parsed: null,
        createdAt: '2026-06-21T00:00:00Z',
      };
    },
  };
}

describe('Header nav + view switching (#22)', () => {
  it('defaults to Play and toggles to History and Controls without a router', async () => {
    const user = userEvent.setup();
    render(<Account db={emptyDb()} user={{ id: 'u1', email: 'me@example.com', isAnonymous: false }} auth={fakeAuth()} />);

    const nav = screen.getByRole('navigation');

    // Default view is Play.
    expect(screen.getByTestId('view-play')).toBeInTheDocument();
    expect(screen.queryByTestId('view-history')).not.toBeInTheDocument();

    // History view.
    await user.click(within(nav).getByRole('button', { name: 'History' }));
    expect(screen.getByTestId('view-history')).toBeInTheDocument();
    expect(screen.queryByTestId('view-play')).not.toBeInTheDocument();

    // Controls view.
    await user.click(within(nav).getByRole('button', { name: 'Controls' }));
    expect(screen.getByTestId('view-controls')).toBeInTheDocument();
    expect(screen.queryByTestId('view-history')).not.toBeInTheDocument();

    // Back to Play.
    await user.click(within(nav).getByRole('button', { name: 'Play' }));
    expect(screen.getByTestId('view-play')).toBeInTheDocument();
  });

  it('exposes a phone menu toggle that collapses/opens the nav cluster (#70)', async () => {
    const user = userEvent.setup();
    render(<Account db={emptyDb()} user={{ id: 'u1', email: 'me@example.com', isAnonymous: false }} auth={fakeAuth()} />);

    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Choosing a view closes the menu again (so the slim header returns).
    const nav = screen.getByRole('navigation');
    await user.click(within(nav).getByRole('button', { name: 'History' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
