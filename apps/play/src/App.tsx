import { useMemo } from 'react';
import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { PuzzlePlay } from './session/index.js';

/**
 * A stable anonymous player id, persisted in localStorage. This is a stand-in
 * until real accounts land in #13 (auth and rating persistence).
 */
function anonymousUserId(): string {
  const key = 'trainer-anon-user-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/** Root of the play app: load Supabase config from the env and play puzzles. */
export function App() {
  const session = useMemo(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return { db: createDataAccess(createSupabaseClient(url, key)), userId: anonymousUserId() };
  }, []);

  return (
    <main>
      <h1>NES Tetris Stacking Trainer</h1>
      <p>Train stacking judgment — where to put each piece, independent of speed.</p>
      {session ? (
        <PuzzlePlay db={session.db} userId={session.userId} />
      ) : (
        <p>
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to play.
        </p>
      )}
    </main>
  );
}
