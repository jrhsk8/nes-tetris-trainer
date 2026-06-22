import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createDataAccess } from '@trainer/data';

// Live acceptance (#72): the curation allowlist is empty-safe and RLS-enforced.
// With NO curator configured, an ordinary (anonymous) account is not a curator
// and every curation write is denied by Supabase RLS regardless of the client —
// proving a cull cannot mutate the shared bank without an allowlist row.
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const liveConfigured = Boolean(url && anonKey);

describe.skipIf(!liveConfigured)('Dev curation RLS gating (live Supabase, #72)', () => {
  it('is empty-safe: a non-curator is not a curator and curation writes are RLS-denied', async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInAnonymously();
    expect(error).toBeNull();
    const userId = data.user!.id;
    const db = createDataAccess(client);

    // Not allowlisted ⇒ not a curator (controls stay hidden).
    expect(await db.isCurator(userId)).toBe(false);

    // A real puzzle to target (public read is allowed).
    const { data: puzzles } = await client.from('puzzles').select('id, active').limit(1);
    const puzzle = puzzles?.[0] as { id: string; active: boolean } | undefined;

    if (puzzle) {
      // Flag + cull are RLS-denied for a non-curator (the insert is rejected).
      await expect(db.flagPuzzle({ puzzleId: puzzle.id, userId, comment: 'nope' })).rejects.toThrow();
      await expect(db.cullPuzzle({ puzzleId: puzzle.id, userId })).rejects.toThrow();

      // A non-curator update of `active` affects zero rows under RLS — the puzzle
      // stays live (the bank is not mutated).
      await db.setPuzzleActive(puzzle.id, false);
      const { data: after } = await client
        .from('puzzles')
        .select('active')
        .eq('id', puzzle.id)
        .maybeSingle();
      expect((after as { active: boolean } | null)?.active).toBe(true);
    }

    // Clean up the throwaway anonymous user (service role).
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (serviceKey) {
      const admin = createClient(url!, serviceKey, { auth: { persistSession: false } });
      await admin.auth.admin.deleteUser(userId);
    }
    await client.auth.signOut();
  });
});
