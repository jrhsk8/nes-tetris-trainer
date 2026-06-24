// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Attempt } from '@trainer/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuth, type AuthApi, type AuthUser } from './auth.js';
import { SignIn } from './SignIn.js';
import { RatingHistory } from './RatingHistory.js';
import { Account } from './Account.js';
import { useAuth } from './useAuth.js';

afterEach(() => cleanup());

function fakeAuth(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    currentUser: vi.fn(async () => null),
    ensureAnonymousSession: vi.fn(async () => null),
    onChange: vi.fn(() => () => {}),
    signInWithEmail: vi.fn(async () => {}),
    signUpWithEmail: vi.fn(async () => {}),
    signInWithProvider: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createAuth OAuth redirect (#77)', () => {
  it('redirects OAuth back to the app base URL (origin + BASE_URL), not bare origin', async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const client = { auth: { signInWithOAuth } } as unknown as SupabaseClient;
    await createAuth(client).signInWithProvider('discord');
    // The redirect carries the GitHub Pages base path (origin + BASE_URL), not
    // the bare origin — so the OAuth round-trip lands back inside the app.
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'discord',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
  });
});

describe('SignIn', () => {
  it('offers email plus Google and Discord sign-in', () => {
    render(<SignIn auth={fakeAuth()} />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Discord' })).toBeInTheDocument();
  });

  it('signs in with email + password', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    render(<SignIn auth={auth} />);

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(auth.signInWithEmail).toHaveBeenCalledWith('player@example.com', 'secret123');
  });

  it('starts an OAuth flow with the chosen provider', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    render(<SignIn auth={auth} />);
    await user.click(screen.getByRole('button', { name: 'Continue with Discord' }));
    expect(auth.signInWithProvider).toHaveBeenCalledWith('discord');
  });
});

describe('RatingHistory', () => {
  const attempt = (ratingAfter: number | null): Attempt => ({
    id: `a-${ratingAfter}`,
    userId: 'u',
    puzzleId: 'p',
    userLine: [{ rotation: 0, col: 0 }],
    solved: true,
    score: null,
    ratingAfter,
    createdAt: '2026-01-01T00:00:00Z',
  });

  it('shows the current rating and attempt count', () => {
    render(<RatingHistory currentRating={1623.6} attempts={[attempt(1600), attempt(1623)]} />);
    expect(screen.getByTestId('current-rating')).toHaveTextContent('1624');
    expect(screen.getByTestId('attempt-count')).toHaveTextContent('2 attempts');
    expect(screen.getByTestId('rating-trend')).toBeInTheDocument();
  });

  it('omits the trend until there are at least two points', () => {
    render(<RatingHistory currentRating={1500} attempts={[]} />);
    expect(screen.queryByTestId('rating-trend')).not.toBeInTheDocument();
  });
});

describe('useAuth', () => {
  it('seeds from the anonymous session it establishes and updates on change', async () => {
    const user: AuthUser = { id: 'u1', email: null, isAnonymous: false };
    let emit: (u: AuthUser | null) => void = () => {};
    const auth = fakeAuth({
      ensureAnonymousSession: vi.fn(async () => user),
      onChange: vi.fn((cb) => {
        emit = cb;
        return () => {};
      }),
    });

    const { result } = renderHook(() => useAuth(auth));
    await waitFor(() => expect(result.current).toEqual(user));
    expect(auth.ensureAnonymousSession).toHaveBeenCalled();

    emit(null);
    await waitFor(() => expect(result.current).toBeNull());
  });
});

describe('Account', () => {
  it('shows the signed-in email, the rating, and lets the user sign out', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    const db = {
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
      async isCurator() {
        return false;
      },
      async flagPuzzle() {},
      async cullPuzzle() {},
      async setPuzzleActive() {},
      async getUserRating() {
        return { userId: 'u1', rating: 1700, deviation: 200, volatility: 0.06 };
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
      async upsertUserRating(r: { userId: string }) {
        return { userId: r.userId, rating: 1700, deviation: 200, volatility: 0.06 };
      },
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
      async upsertUserPrefs(p: { userId: string; bindings: Record<string, string> }) {
        return p;
      },
      async uploadSubmissionImage() { return ""; },
      async insertSubmission(s: { imagePath: string; submitter: string }) {
        return {
          id: 'sub-1',
          imagePath: s.imagePath,
          submitter: s.submitter,
          status: 'pending' as const,
          reason: null,
          parsed: null,
          createdAt: '2026-06-21T00:00:00Z',
        };
      },
    };

    render(<Account db={db} user={{ id: 'u1', email: 'me@example.com', isAnonymous: false }} auth={auth} />);

    expect(screen.getByTestId('account-email')).toHaveTextContent('me@example.com');
    await waitFor(() => expect(screen.getByTestId('current-rating')).toHaveTextContent('1700'));

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
