/**
 * Auth wrapper (#13) — a thin typed surface over Supabase Auth so the UI never
 * touches the raw client. Supports email/password plus OAuth (Google and
 * Discord), per .claude/docs/PRD-v1.md "Auth".
 */

import type { Provider, SupabaseClient, User } from '@supabase/supabase-js';

/** The OAuth providers offered (the NES Tetris community lives on Discord). */
export type OAuthProvider = 'google' | 'discord';

/** A minimal authenticated user. */
export interface AuthUser {
  id: string;
  email: string | null;
  /** True for an anonymous session (#39/#67) — blocked from submitting boards. */
  isAnonymous: boolean;
}

/** The auth operations the play app needs. */
export interface AuthApi {
  /** The currently signed-in user, or null. */
  currentUser(): Promise<AuthUser | null>;
  /**
   * Establish an ANONYMOUS session if none exists, so `auth.uid()` is real and
   * RLS passes for every visitor (#39) — fixing the "rating never changes" bug,
   * where the all-zeros dev-bypass user could not satisfy the per-user insert
   * policies. Returns the existing user when already signed in, the new
   * anonymous user otherwise, or `null` when no session could be established
   * (e.g. anonymous sign-ins are disabled on the Supabase project).
   */
  ensureAnonymousSession(): Promise<AuthUser | null>;
  /** Subscribe to sign-in/out; returns an unsubscribe function. */
  onChange(callback: (user: AuthUser | null) => void): () => void;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;
  signInWithProvider(provider: OAuthProvider): Promise<void>;
  /**
   * Attach an email + password to the CURRENT (anonymous) session in place (#77),
   * upgrading it to a permanent account **without changing `auth.uid()`** — so the
   * player's rating, attempts, prefs, seen-window and misses all carry over. A
   * confirmation email is sent (if email confirmation is enabled on the project);
   * the identity becomes permanent once the player confirms.
   */
  linkEmail(email: string, password: string): Promise<void>;
  /**
   * Link an OAuth identity (Google/Discord) to the CURRENT (anonymous) session in
   * place (#77), preserving `auth.uid()` so all data carries over and the player
   * gains cross-device sync. Requires "Manual linking" enabled on the project.
   */
  linkWithProvider(provider: OAuthProvider): Promise<void>;
  signOut(): Promise<void>;
}

function toAuthUser(user: User | null | undefined): AuthUser | null {
  return user
    ? { id: user.id, email: user.email ?? null, isAnonymous: user.is_anonymous ?? false }
    : null;
}

/** Build an {@link AuthApi} over a Supabase client. */
export function createAuth(client: SupabaseClient): AuthApi {
  return {
    async currentUser() {
      const { data } = await client.auth.getUser();
      return toAuthUser(data.user);
    },

    async ensureAnonymousSession() {
      const { data } = await client.auth.getUser();
      if (data.user) return toAuthUser(data.user);
      const { data: anon, error } = await client.auth.signInAnonymously();
      if (error) {
        // Anonymous sign-ins are disabled or unavailable; play falls back to the
        // sign-in screen rather than crashing. Surfaced for diagnosis.
        console.warn(`anonymous sign-in unavailable: ${error.message}`);
        return null;
      }
      return toAuthUser(anon.user);
    },

    onChange(callback) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        callback(toAuthUser(session?.user));
      });
      return () => data.subscription.unsubscribe();
    },

    async signInWithEmail(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },

    async signUpWithEmail(email, password) {
      const { error } = await client.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
    },

    async signInWithProvider(provider) {
      const { error } = await client.auth.signInWithOAuth({
        provider: provider as Provider,
        // Return to the app's base URL INCLUDING the GitHub Pages base path
        // (origin + BASE_URL), not the bare origin (#77): on Pages the app lives
        // under `/nes-tetris-trainer/`, so a bare-origin redirect lands off-app.
        options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
      });
      if (error) throw new Error(error.message);
    },

    async linkEmail(email, password) {
      // Upgrade the anonymous user in place: attach an email + password to the
      // SAME user id (#77). Supabase sends a confirmation email (if enabled); the
      // account becomes permanent on confirm, and rating/attempts/prefs are kept.
      const { error } = await client.auth.updateUser({ email, password });
      if (error) throw new Error(error.message);
    },

    async linkWithProvider(provider) {
      const { error } = await client.auth.linkIdentity({
        provider: provider as Provider,
        // Same Pages-base redirect as a fresh OAuth sign-in (#77), so the linking
        // round-trip lands back inside the app.
        options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
      });
      if (error) throw new Error(error.message);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new Error(error.message);
    },
  };
}
