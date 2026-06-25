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
    continueAsGuest: vi.fn(async () => ({ id: 'guest', email: null, isAnonymous: true })),
    onChange: vi.fn(() => () => {}),
    signInWithEmail: vi.fn(async () => {}),
    signUpWithEmail: vi.fn(async () => {}),
    signInWithProvider: vi.fn(async () => {}),
    linkEmail: vi.fn(async () => {}),
    linkWithProvider: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createAuth OAuth redirect (#77)', () => {
  it('redirects OAuth back to the live app URL, preserving the Pages repo subpath', async () => {
    // Simulate being served under the GitHub Pages project subpath, with a hash
    // route + query in play — the exact shape that produced the off-app 404.
    window.history.pushState({}, '', '/nes-tetris-trainer/?x=1#/play');
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const client = { auth: { signInWithOAuth } } as unknown as SupabaseClient;
    await createAuth(client).signInWithProvider('discord');
    // Returns to origin + pathname (subpath kept, hash/query dropped) — NOT the
    // bare origin, which on Pages is the user root with no site (404).
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'discord',
      options: { redirectTo: window.location.origin + '/nes-tetris-trainer/' },
    });
  });
});

describe('createAuth in-place linking (#77)', () => {
  it('links an OAuth identity to the current session (preserving the UID), returning to the live app URL', async () => {
    window.history.pushState({}, '', '/nes-tetris-trainer/');
    const linkIdentity = vi.fn(async () => ({ error: null }));
    const client = { auth: { linkIdentity } } as unknown as SupabaseClient;
    await createAuth(client).linkWithProvider('google');
    // linkIdentity (NOT signInWithOAuth) upgrades the anon session in place, so
    // the UID — and all the player's rating/attempts — is preserved.
    expect(linkIdentity).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/nes-tetris-trainer/' },
    });
  });

  it('links an email by updating the current user in place (not a fresh sign-up)', async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    const client = { auth: { updateUser } } as unknown as SupabaseClient;
    await createAuth(client).linkEmail('me@example.com', 'secret123');
    // updateUser attaches the email to the SAME user id, keeping their data.
    expect(updateUser).toHaveBeenCalledWith({ email: 'me@example.com', password: 'secret123' });
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

  it('surfaces an OAuth failure instead of swallowing it (#77)', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      linkWithProvider: vi.fn(async () => {
        throw new Error('Manual linking is disabled');
      }),
    });
    render(<SignIn auth={auth} link />);
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Manual linking is disabled');
  });

  it('in link mode, OAuth and email upgrade the session in place (UID-preserving), not a fresh sign-in (#77)', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    render(<SignIn auth={auth} link />);

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(auth.linkWithProvider).toHaveBeenCalledWith('google');
    expect(auth.signInWithProvider).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(auth.linkEmail).toHaveBeenCalledWith('me@example.com', 'secret123');
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
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

/** A minimal {@link Account} db stub — enough for the account shell to mount. */
function makeAccountDb() {
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
    async uploadSubmissionImage() {
      return '';
    },
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
}

describe('Account', () => {
  it('shows the signed-in email, the rating, and lets the user sign out', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    const db = makeAccountDb();

    render(<Account db={db} user={{ id: 'u1', email: 'me@example.com', isAnonymous: false }} auth={auth} />);

    expect(screen.getByTestId('account-email')).toHaveTextContent('me@example.com');
    await waitFor(() => expect(screen.getByTestId('current-rating')).toHaveTextContent('1700'));

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('offers an anonymous player a Sign-in affordance that reveals in-place linking (#77)', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    render(
      <Account db={makeAccountDb()} user={{ id: 'anon1', email: null, isAnonymous: true }} auth={auth} />,
    );

    // Anonymous: a "Sign in" control sits beside "Sign out"; the panel is closed.
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    expect(screen.queryByTestId('signin-panel')).not.toBeInTheDocument();

    // Opening it reveals the link-mode SignIn (Google/Discord/email upgrade).
    await user.click(signIn);
    const panel = screen.getByTestId('signin-panel');
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();

    // The OAuth button links in place (preserves the UID), not a fresh sign-in.
    await user.click(screen.getByRole('button', { name: 'Continue with Discord' }));
    expect(auth.linkWithProvider).toHaveBeenCalledWith('discord');
    expect(auth.signInWithProvider).not.toHaveBeenCalled();
  });

  it('does NOT offer the Sign-in affordance to a non-anonymous player (#77)', () => {
    render(
      <Account
        db={makeAccountDb()}
        user={{ id: 'u1', email: 'me@example.com', isAnonymous: false }}
        auth={fakeAuth()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('signin-panel')).not.toBeInTheDocument();
  });
});
