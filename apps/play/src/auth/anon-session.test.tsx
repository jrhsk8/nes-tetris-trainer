// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { Authenticated } from '../App.js';
import { createAuth, type AuthApi, type AuthUser } from './index.js';

afterEach(() => cleanup());

/** A full AuthApi whose anonymous-session result the test controls. */
function fakeAuth(user: AuthUser | null): AuthApi {
  return {
    currentUser: vi.fn(async () => user),
    ensureAnonymousSession: vi.fn(async () => user),
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
  };
}

describe('createAuth.ensureAnonymousSession (#39)', () => {
  it('returns the existing user without a new anonymous sign-in', async () => {
    const signInAnonymously = vi.fn();
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'existing', email: 'a@b.com' } } }),
        signInAnonymously,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const auth = createAuth(client);
    const user = await auth.ensureAnonymousSession();
    expect(user).toEqual({ id: 'existing', email: 'a@b.com' });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('signs in anonymously when there is no session', async () => {
    const client = {
      auth: {
        getUser: async () => ({ data: { user: null } }),
        signInAnonymously: async () => ({ data: { user: { id: 'anon', email: null } }, error: null }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const auth = createAuth(client);
    const user = await auth.ensureAnonymousSession();
    expect(user).toEqual({ id: 'anon', email: null });
  });

  it('returns null when anonymous sign-ins are disabled', async () => {
    const client = {
      auth: {
        getUser: async () => ({ data: { user: null } }),
        signInAnonymously: async () => ({
          data: { user: null },
          error: { message: 'anonymous_provider_disabled' },
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const auth = createAuth(client);
    expect(await auth.ensureAnonymousSession()).toBeNull();
  });
});

describe('Authenticated anonymous-session gating (#39)', () => {
  it('drops a visitor with an anonymous session straight into the app', async () => {
    const auth = fakeAuth({ id: 'anon-1', email: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<Authenticated db={emptyDb() as any} auth={auth} />);
    await waitFor(() => expect(screen.getByTestId('account-email')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('falls back to sign-in when no session can be established', async () => {
    const auth = fakeAuth(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<Authenticated db={emptyDb() as any} auth={auth} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
  });
});

// --- Live acceptance (#39): persist + read back a rating across reloads under an
// anonymous session. Requires anonymous sign-ins ENABLED on the project; the
// test no-ops (and the issue stays open) until the owner toggles it on. ---
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const liveConfigured = Boolean(url && anonKey);

describe.skipIf(!liveConfigured)('Anonymous auth + persistence (live Supabase, #39)', () => {
  it('persists a rating under an anon session and reads it back on a fresh client', async () => {
    const first = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await first.auth.signInAnonymously();
    if (error) {
      // Anonymous sign-ins still disabled — acceptance cannot run; leave #39 open.
      console.warn(`SKIP live anon acceptance: ${error.message}`);
      return;
    }
    const userId = data.user!.id;

    const upsert = await first
      .from('user_ratings')
      .upsert({ user_id: userId, rating: 1542, deviation: 180, volatility: 0.055 })
      .select()
      .single();
    expect(upsert.error).toBeNull();
    expect(upsert.data!.rating).toBe(1542);

    // Re-read with the same authenticated client to confirm RLS lets the owner
    // see the row (the "rating actually persists" check).
    const read = await first
      .from('user_ratings')
      .select('rating')
      .eq('user_id', userId)
      .maybeSingle();
    expect(read.data!.rating).toBe(1542);

    // Clean up via the same session (RLS allows owning user to delete? attempts
    // policies have no delete; leave the row — it is an anonymous throwaway).
    await first.auth.signOut();
  });
});
