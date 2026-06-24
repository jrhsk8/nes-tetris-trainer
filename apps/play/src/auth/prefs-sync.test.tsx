// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserPrefs } from '@trainer/data';
import type { AuthApi } from './auth.js';
import { Account, type AccountDb } from './Account.js';

afterEach(() => cleanup());

function fakeAuth(): AuthApi {
  return {
    currentUser: vi.fn(async () => null),
    ensureAnonymousSession: vi.fn(async () => null),
    onChange: vi.fn(() => () => {}),
    signInWithEmail: vi.fn(async () => {}),
    signUpWithEmail: vi.fn(async () => {}),
    signInWithProvider: vi.fn(async () => {}),
    linkEmail: vi.fn(async () => {}),
    linkWithProvider: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  };
}

/** A db with an empty bank and configurable prefs, recording upserts. */
function prefsDb(initial: UserPrefs | null, upserts: UserPrefs[]): AccountDb {
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
      return initial;
    },
    async upsertUserPrefs(p) {
      upserts.push(p);
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

describe('Controls prefs sync (#24)', () => {
  it('loads saved bindings on sign-in and persists a rebind', async () => {
    const user = userEvent.setup();
    const upserts: UserPrefs[] = [];
    const db = prefsDb({ userId: 'u1', bindings: { 'rotate-cw': 'k' } }, upserts);

    render(<Account db={db} user={{ id: 'u1', email: 'me@example.com', isAnonymous: false }} auth={fakeAuth()} />);

    await user.click(screen.getByRole('button', { name: 'Controls' }));

    // The saved binding loaded: rotate-cw shows K, not the default X.
    await waitFor(() =>
      expect(screen.getByLabelText('Rebind Rotate clockwise')).toHaveTextContent('K'),
    );

    // Rebind move-left to q and confirm it is persisted.
    await user.click(screen.getByLabelText('Rebind Move left'));
    await user.keyboard('q');

    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].bindings['move-left']).toBe('q');
    // The previously-loaded binding is preserved through the rebind.
    expect(upserts[0].bindings['rotate-cw']).toBe('k');
    expect(screen.getByLabelText('Rebind Move left')).toHaveTextContent('Q');
  });

  it('loads the saved mute pref and persists a toggle, preserving bindings (#61)', async () => {
    const user = userEvent.setup();
    const upserts: UserPrefs[] = [];
    const db = prefsDb({ userId: 'u1', bindings: { 'rotate-cw': 'k' }, muted: true }, upserts);

    render(<Account db={db} user={{ id: 'u1', email: 'me@example.com', isAnonymous: false }} auth={fakeAuth()} />);
    await user.click(screen.getByRole('button', { name: 'Controls' }));

    // The saved mute loaded: the sound toggle is unchecked (muted).
    const toggle = () => screen.getByTestId('control-sound').querySelector('input')!;
    await waitFor(() => expect(toggle()).not.toBeChecked());

    // Un-mute and confirm it persists alongside the loaded bindings.
    await user.click(toggle());
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].muted).toBe(false);
    expect(upserts[0].bindings['rotate-cw']).toBe('k');
  });
});
