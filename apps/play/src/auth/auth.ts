/**
 * Auth wrapper (#13) — a thin typed surface over Supabase Auth so the UI never
 * touches the raw client. Supports email/password plus OAuth (Google and
 * Discord), per docs/PRD-v1.md "Auth".
 */

import type { Provider, SupabaseClient, User } from '@supabase/supabase-js';

/** The OAuth providers offered (the NES Tetris community lives on Discord). */
export type OAuthProvider = 'google' | 'discord';

/** A minimal authenticated user. */
export interface AuthUser {
  id: string;
  email: string | null;
}

/** The auth operations the play app needs. */
export interface AuthApi {
  /** The currently signed-in user, or null. */
  currentUser(): Promise<AuthUser | null>;
  /** Subscribe to sign-in/out; returns an unsubscribe function. */
  onChange(callback: (user: AuthUser | null) => void): () => void;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;
  signInWithProvider(provider: OAuthProvider): Promise<void>;
  signOut(): Promise<void>;
}

function toAuthUser(user: User | null | undefined): AuthUser | null {
  return user ? { id: user.id, email: user.email ?? null } : null;
}

/** Build an {@link AuthApi} over a Supabase client. */
export function createAuth(client: SupabaseClient): AuthApi {
  return {
    async currentUser() {
      const { data } = await client.auth.getUser();
      return toAuthUser(data.user);
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
        options: { redirectTo: window.location.origin },
      });
      if (error) throw new Error(error.message);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new Error(error.message);
    },
  };
}
