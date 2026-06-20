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
    onChange: vi.fn(() => () => {}),
    signInWithEmail: vi.fn(async () => {}),
    signUpWithEmail: vi.fn(async () => {}),
    signInWithProvider: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  };
}

/** A minimal db with an empty bank (the Play view short-circuits). */
function emptyDb(): AccountDb {
  return {
    async getUserAttempts() {
      return [];
    },
    async getUserRating() {
      return null;
    },
    async getRandomPuzzle() {
      return null;
    },
    async upsertUserRating(r) {
      return { userId: r.userId, rating: 1500, deviation: 200, volatility: 0.06 };
    },
    async insertAttempt() {
      throw new Error('not used');
    },
    async getUserPrefs() {
      return null;
    },
    async upsertUserPrefs(p) {
      return p;
    },
  };
}

describe('Header nav + view switching (#22)', () => {
  it('defaults to Play and toggles to History and Controls without a router', async () => {
    const user = userEvent.setup();
    render(<Account db={emptyDb()} user={{ id: 'u1', email: 'me@example.com' }} auth={fakeAuth()} />);

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
});
