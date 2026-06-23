import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createDataAccess } from '@trainer/data';
import { boardMetrics, emptyBoard, encodeBoard, type Line } from '@trainer/core';

// Live acceptance (#80): the star-rating table is own-row RLS (anonymous
// allowed). A user may read/write ONLY their own rating row; the community
// average still aggregates across all users via the SECURITY DEFINER stats
// function (no individual row exposed).
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const configured = Boolean(url && anonKey && serviceKey);

const sampleLine: Line = [
  { rotation: 0, col: 0 },
  { rotation: 1, col: 3 },
];

describe.skipIf(!configured)('Star-rating RLS own-row (live Supabase, #80)', () => {
  it('lets a user read/write only their own rating; community avg still aggregates', async () => {
    const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    // A throwaway puzzle so the only star rows are the ones this test makes.
    const adminDb = createDataAccess(admin);
    const puzzle = await adminDb.insertPuzzle({
      board: encodeBoard(emptyBoard()),
      piece1: 'T',
      piece2: 'L',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
    });

    // A second user's rating, seeded past RLS via the service role.
    const userB = crypto.randomUUID();
    await admin.from('puzzle_star_ratings').insert({ user_id: userB, puzzle_id: puzzle.id, stars: 2 });

    // The player: a real anonymous session (own-row RLS applies).
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data: auth, error: authErr } = await client.auth.signInAnonymously();
    expect(authErr).toBeNull();
    const userA = auth.user!.id;
    const db = createDataAccess(client);

    try {
      // A writes its OWN rating (anonymous allowed) and reads it back.
      await db.upsertStarRating(userA, puzzle.id, 4);
      expect(await db.getMyStarRating(userA, puzzle.id)).toBe(4);

      // A cannot read B's row (own-row select): the direct query returns nothing.
      const { data: bRows } = await client
        .from('puzzle_star_ratings')
        .select('*')
        .eq('user_id', userB);
      expect(bRows ?? []).toHaveLength(0);

      // A cannot write a row owned by someone else (own-row insert check denies it).
      const { error: spoofErr } = await client
        .from('puzzle_star_ratings')
        .insert({ user_id: userB, puzzle_id: puzzle.id, stars: 5 });
      expect(spoofErr).not.toBeNull();

      // The community average still sees BOTH ratings (A=4, B=2 → 3.0, count 2)
      // via the SECURITY DEFINER aggregate, despite own-row select.
      expect(await db.getStarStats(puzzle.id)).toEqual({ avg: 3, count: 2 });
    } finally {
      await admin.from('puzzles').delete().eq('id', puzzle.id); // cascades star rows
      await admin.auth.admin.deleteUser(userA);
      await client.auth.signOut();
    }
  });
});
