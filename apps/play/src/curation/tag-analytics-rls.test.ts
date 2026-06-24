import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDataAccess, type CurationTagStat } from '@trainer/data';

// Live acceptance (#87): the per-tag curation aggregate returns correct flag /
// cull / star numbers over EVERY user, exposing no individual row. Verified as a
// non-destructive DELTA against an existing tagged puzzle: snapshot the tag's
// numbers, seed a known set of flag/cull/star rows via the service role (which
// bypasses RLS), and assert the aggregate moved by exactly that much — then clean
// up. Skips without live creds, or if the bank has no tagged puzzle yet (the #83
// migration not run).
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const liveConfigured = Boolean(url && anonKey && serviceKey);

describe.skipIf(!liveConfigured)('Curation analytics by tag (live Supabase, #87)', () => {
  const admin = liveConfigured
    ? createClient(url!, serviceKey!, { auth: { persistSession: false } })
    : (null as unknown as SupabaseClient);

  const stat = (rows: CurationTagStat[], tag: string) => rows.find((r) => r.tag === tag);

  it('aggregates per-tag flag/cull/stars correctly, exposing no individual row', { timeout: 30000 }, async () => {
    // An existing active puzzle that already carries at least one tag.
    const { data } = await admin
      .from('puzzles')
      .select('id, tags')
      .eq('active', true)
      .not('tags', 'eq', '{}')
      .limit(1);
    const puzzle = data?.[0] as { id: string; tags: string[] } | undefined;
    if (!puzzle || puzzle.tags.length === 0) {
      // The bank is not tagged yet (#83 migration unrun) — nothing to assert.
      return;
    }
    const tag = puzzle.tags[0];

    // A throwaway verified user to own the seeded star rating.
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const { data: u } = await admin.auth.admin.createUser({
      email: `tagstats-${stamp}@example.com`,
      password: `Pw-${stamp}-aA1`,
      email_confirm: true,
    });
    const userId = u.user!.id;

    // Read the aggregate through the ANON key (the RPC is granted to anon) — proving
    // the SECURITY DEFINER function reaches past own-row RLS for a plain client.
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const db = createDataAccess(anon);

    try {
      const before = await db.getCurationTagStats();
      const b = stat(before, tag) ?? { flagCount: 0, cullCount: 0, ratingCount: 0 };

      // Seed 2 flags, 1 cull, and one 5-star rating on the puzzle (service role
      // bypasses RLS; the raw 'cull' row does NOT touch `active`, so non-destructive).
      await admin.from('puzzle_flags').insert([
        { puzzle_id: puzzle.id, user_id: userId, action: 'flag', comment: 't1' },
        { puzzle_id: puzzle.id, user_id: userId, action: 'flag', comment: 't2' },
        { puzzle_id: puzzle.id, user_id: userId, action: 'cull', comment: 't3' },
      ]);
      await admin.from('puzzle_star_ratings').insert({ user_id: userId, puzzle_id: puzzle.id, stars: 5 });

      const after = await db.getCurationTagStats();
      const a = stat(after, tag)!;
      expect(a.flagCount).toBe(b.flagCount + 2);
      expect(a.cullCount).toBe(b.cullCount + 1);
      expect(a.ratingCount).toBe(b.ratingCount + 1);
      // The aggregate is a number, never a list of user rows.
      expect(typeof a.avgStars).toBe('number');
    } finally {
      await admin.from('puzzle_flags').delete().eq('user_id', userId);
      await admin.from('puzzle_star_ratings').delete().eq('user_id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
