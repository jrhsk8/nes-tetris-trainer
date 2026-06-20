import { useMemo } from 'react';
import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { Account, SignIn, createAuth, useAuth } from './auth/index.js';

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
      <h1>NES Tetris Stacking Trainer</h1>
      <p>Train stacking judgment — where to put each piece, independent of speed.</p>
      {services ? (
        <Authenticated db={services.db} auth={services.auth} />
      ) : (
        <p>
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to play.
        </p>
      )}
    </main>
  );
}

function Authenticated({
  db,
  auth,
}: {
  db: ReturnType<typeof createDataAccess>;
  auth: ReturnType<typeof createAuth>;
}) {
  const user = useAuth(auth);
  if (user === undefined) return <p>Loading…</p>;
  if (user === null) return <SignIn auth={auth} />;
  return <Account db={db} user={user} auth={auth} />;
}
