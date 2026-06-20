/**
 * SignIn (#13) — email/password plus OAuth (Google, Discord). Lets a player
 * create an account or sign in so their rating is saved and portable.
 */

import { useState } from 'react';
import type { AuthApi } from './auth.js';

export interface SignInProps {
  auth: AuthApi;
}

export function SignIn({ auth }: SignInProps) {
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
      if (mode === 'signin') {
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

  return (
    <section aria-label="sign in">
      <h2>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h2>

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
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>
        <button type="submit">{mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
      </form>

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

      <div className="oauth">
        <button type="button" onClick={() => void auth.signInWithProvider('google')}>
          Continue with Google
        </button>
        <button type="button" onClick={() => void auth.signInWithProvider('discord')}>
          Continue with Discord
        </button>
      </div>

      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
