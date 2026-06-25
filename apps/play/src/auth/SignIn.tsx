/**
 * SignIn (#13, #77) — email/password plus OAuth (Google, Discord). Lets a player
 * create an account or sign in so their rating is saved and portable.
 *
 * Two modes:
 *  - **fresh** (default): a signed-out visitor signs in / signs up; OAuth starts a
 *    new session.
 *  - **link** (`link`): an ANONYMOUS player upgrades their current session in place
 *    — email/OAuth attach to the SAME user id (`linkEmail` / `linkWithProvider`),
 *    so their existing rating/attempts carry over and they gain cross-device sync.
 *    Used by the Account "Sign in" affordance.
 */

import { useState } from 'react';
import type { AuthApi } from './auth.js';

export interface SignInProps {
  auth: AuthApi;
  /**
   * Link the chosen identity to the current anonymous session in place (#77),
   * preserving the UID, instead of starting a fresh session. Defaults to false.
   */
  link?: boolean;
}

export function SignIn({ auth, link = false }: SignInProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      if (link) {
        // Attach this email to the existing anonymous account (same UID).
        await auth.linkEmail(email, password);
        setNotice('Check your email to confirm. Your progress stays on this account.');
      } else if (mode === 'signin') {
        await auth.signInWithEmail(email, password);
      } else {
        await auth.signUpWithEmail(email, password);
        setNotice('Account created. Check your email if confirmation is required, then sign in.');
        setMode('signin');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
    }
  }

  async function oauth(provider: 'google' | 'discord') {
    setError(null);
    setNotice(null);
    try {
      await (link ? auth.linkWithProvider(provider) : auth.signInWithProvider(provider));
    } catch (e) {
      // Surface provider/linking failures (e.g. a provider not enabled, or Manual
      // linking disabled) instead of swallowing them in an unhandled rejection.
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    }
  }

  const heading = link ? 'Save your progress' : mode === 'signin' ? 'Sign in' : 'Create an account';
  const submitLabel = link ? 'Save' : mode === 'signin' ? 'Sign in' : 'Sign up';

  return (
    <section aria-label="sign in">
      <h2>{heading}</h2>
      {link ? (
        <p>Sign in to keep your rating across devices — your current progress carries over.</p>
      ) : null}

      <form onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signin' && !link ? 'current-password' : 'new-password'}
          />
        </label>
        <button type="submit">{submitLabel}</button>
      </form>

      {link ? null : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setNotice(null);
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
          }}
        >
          {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      )}

      <div className="oauth">
        <button type="button" onClick={() => void oauth('google')}>
          Continue with Google
        </button>
        <button type="button" onClick={() => void oauth('discord')}>
          Continue with Discord
        </button>
      </div>

      {link ? null : (
        <button
          type="button"
          className="guest-btn"
          onClick={() => {
            setError(null);
            void auth.continueAsGuest().catch((e) => {
              setError(e instanceof Error ? e.message : 'Could not start guest session');
            });
          }}
        >
          Continue as guest
        </button>
      )}

      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
