// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Authenticated } from '../App.js';
import type { AuthApi } from './auth.js';
import { bypassUser, DEV_BYPASS_USER } from './devBypass.js';

afterEach(() => cleanup());

/** Auth that reports nobody signed in. */
function signedOutAuth(): AuthApi {
  return {
    currentUser: vi.fn(async () => null),
    onChange: vi.fn(() => () => {}),
    signInWithEmail: vi.fn(async () => {}),
    signUpWithEmail: vi.fn(async () => {}),
    signInWithProvider: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  };
}

/** A minimal db; the empty bank short-circuits the play loop. */
function emptyDb() {
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
    async upsertUserRating(r: { userId: string }) {
      return { userId: r.userId, rating: 1500, deviation: 200, volatility: 0.06 };
    },
    async insertAttempt() {
      throw new Error('not used');
    },
  };
}

describe('Dev login bypass (#20)', () => {
  it('bypassUser yields the dev user only when enabled', () => {
    expect(bypassUser(true)).toEqual(DEV_BYPASS_USER);
    expect(bypassUser(false)).toBeNull();
  });

  it('with bypass OFF, a signed-out visitor is sent to sign-in', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<Authenticated db={emptyDb() as any} auth={signedOutAuth()} bypass={false} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
  });

  it('with bypass ON, a signed-out visitor skips login and uses the app', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<Authenticated db={emptyDb() as any} auth={signedOutAuth()} bypass={true} />);
    await waitFor(() =>
      expect(screen.getByTestId('account-email')).toHaveTextContent(DEV_BYPASS_USER.email!),
    );
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
