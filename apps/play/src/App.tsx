import { useMemo, type ReactNode } from 'react';
import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { Account, SignIn, createAuth, useAuth } from './auth/index.js';
import { AUTH_BYPASS_ENABLED, bypassUser } from './auth/devBypass.js';
import { WORDMARK } from './branding.js';

/**
 * A slim top bar: a small wordmark on the left and an optional cluster of
 * controls (the view nav / account actions) on the right (#32). The signed-in
 * shell ({@link Account}) renders its own bar with the same chrome, so the play
 * screen only ever has this single bar — no stacked headers.
 */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="top-bar">
      <span className="wordmark">{WORDMARK}</span>
      {children ? <div className="top-bar-end">{children}</div> : null}
    </header>
  );
}

/**
 * Root of the play app. Loads Supabase config from the env, then gates play
 * behind auth (#13): signed-out players see the sign-in screen; signed-in
 * players get their rating history and the play loop, keyed to their account.
 */
export function App() {
  const services = useMemo(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const client = createSupabaseClient(url, key, { persistSession: true });
    return { db: createDataAccess(client), auth: createAuth(client) };
  }, []);

  return (
    <main>
      {services ? (
        <Authenticated db={services.db} auth={services.auth} />
      ) : (
        <>
          <TopBar />
          <p>
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to play.
          </p>
        </>
      )}
    </main>
  );
}

export function Authenticated({
  db,
  auth,
  bypass = AUTH_BYPASS_ENABLED,
}: {
  db: ReturnType<typeof createDataAccess>;
  auth: ReturnType<typeof createAuth>;
  /** Dev login bypass (#20); defaults to the `VITE_AUTH_BYPASS` build flag. */
  bypass?: boolean;
}) {
  const user = useAuth(auth);
  if (user === undefined)
    return (
      <>
        <TopBar />
        <p>Loading…</p>
      </>
    );
  // DEV-ONLY login bypass (#20, TEMPORARY): with VITE_AUTH_BYPASS on, an
  // unauthenticated visitor plays as a throwaway dev user instead of being sent
  // to sign-in. Remove this single guard + ./auth/devBypass.ts to restore login.
  const effectiveUser = user ?? bypassUser(bypass);
  if (effectiveUser === null)
    return (
      <>
        <TopBar />
        <SignIn auth={auth} />
      </>
    );
  return <Account db={db} user={effectiveUser} auth={auth} />;
}
