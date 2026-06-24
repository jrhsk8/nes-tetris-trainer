import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDataAccess } from '@trainer/data';

// Live acceptance (#78): admin = an EMAIL-allowlisted curator, RLS-enforced.
// A verified, non-anonymous, allowlisted email may flag/cull; an anonymous or a
// verified-but-not-allowlisted session is denied — the shared bank cannot be
// mutated without an allowlist row. Verified-email sessions are minted via the
// service-role admin API (createUser + email/password sign-in), so the RLS gate
// is exercised end-to-end without the dashboard OAuth config (#77).
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const liveConfigured = Boolean(url && anonKey && serviceKey);

describe.skipIf(!liveConfigured)('Admin = email-allowlisted curator RLS (live Supabase, #78)', () => {
  const admin = liveConfigured
    ? createClient(url!, serviceKey!, { auth: { persistSession: false } })
    : (null as unknown as SupabaseClient);

  /** Create a verified-email user, optionally allowlisting their email. */
  async function makeUser(allowlist: boolean) {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `rls-${stamp}@example.com`;
    const password = `Pw-${stamp}-aA1`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    const userId = data.user!.id;
    if (allowlist) {
      const { error: ae } = await admin.from('admin_emails').insert({ email, note: 'test' });
      expect(ae).toBeNull();
    }
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error: se } = await client.auth.signInWithPassword({ email, password });
    expect(se).toBeNull();
    return { email, userId, client };
  }

  async function cleanup(email: string, userId: string) {
    await admin.from('puzzle_flags').delete().eq('user_id', userId);
    await admin.from('admin_emails').delete().eq('email', email);
    await admin.auth.admin.deleteUser(userId);
  }

  async function aPuzzle(client: SupabaseClient) {
    const { data } = await client.from('puzzles').select('id, active').eq('active', true).limit(1);
    return data?.[0] as { id: string; active: boolean } | undefined;
  }

  it('ALLOWS an allowlisted, verified, non-anon admin to flag and cull', { timeout: 30000 }, async () => {
    const { email, userId, client } = await makeUser(true);
    try {
      const db = createDataAccess(client);
      expect(await db.isAdmin()).toBe(true);

      const puzzle = await aPuzzle(admin);
      expect(puzzle).toBeDefined();

      // Flag succeeds (append to the log).
      await db.flagPuzzle({ puzzleId: puzzle!.id, userId, comment: 'admin test flag' });
      // Cull succeeds: the puzzle flips inactive under RLS.
      await db.cullPuzzle({ puzzleId: puzzle!.id, userId });
      const { data: after } = await admin
        .from('puzzles')
        .select('active')
        .eq('id', puzzle!.id)
        .single();
      expect((after as { active: boolean }).active).toBe(false);

      // Restore the bank (service role) — never leave a real puzzle culled.
      await admin.from('puzzles').update({ active: true }).eq('id', puzzle!.id);
    } finally {
      await cleanup(email, userId);
    }
  });

  it('DENIES a verified email that is NOT on the allowlist', { timeout: 30000 }, async () => {
    const { email, userId, client } = await makeUser(false);
    try {
      const db = createDataAccess(client);
      expect(await db.isAdmin()).toBe(false);

      const puzzle = await aPuzzle(client);
      if (puzzle) {
        await expect(
          db.flagPuzzle({ puzzleId: puzzle.id, userId, comment: 'nope' }),
        ).rejects.toThrow();
        await expect(db.cullPuzzle({ puzzleId: puzzle.id, userId })).rejects.toThrow();
        // A non-admin update affects zero rows — the puzzle stays live.
        await db.setPuzzleActive(puzzle.id, false);
        const { data: still } = await admin
          .from('puzzles')
          .select('active')
          .eq('id', puzzle.id)
          .single();
        expect((still as { active: boolean }).active).toBe(true);
      }
    } finally {
      await cleanup(email, userId);
    }
  });

  it('DENIES an anonymous session', { timeout: 30000 }, async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInAnonymously();
    expect(error).toBeNull();
    const userId = data.user!.id;
    try {
      const db = createDataAccess(client);
      expect(await db.isAdmin()).toBe(false);
      const { data: puzzles } = await client.from('puzzles').select('id').limit(1);
      const puzzle = puzzles?.[0] as { id: string } | undefined;
      if (puzzle) {
        await expect(
          db.flagPuzzle({ puzzleId: puzzle.id, userId, comment: 'nope' }),
        ).rejects.toThrow();
      }
    } finally {
      await admin.auth.admin.deleteUser(userId);
      await client.auth.signOut();
    }
  });
});
