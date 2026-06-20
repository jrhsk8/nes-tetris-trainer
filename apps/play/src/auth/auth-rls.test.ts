import { describe, it, expect, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Live auth + RLS integration test (#13 acceptance): a real user signs in and
// can read/write only their own rows. Skipped when Supabase env is absent.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(url && serviceKey && anonKey);

const admin: SupabaseClient | null = configured
  ? createClient(url!, serviceKey!, { auth: { persistSession: false } })
  : null;

const createdUserIds: string[] = [];

afterAll(async () => {
  if (!admin) return;
  for (const id of createdUserIds) {
    await admin.from('attempts').delete().eq('user_id', id);
    await admin.from('user_ratings').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
});

async function makeSignedInUser(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `ralph-${Date.now()}-${createdUserIds.length}@example.test`;
  const password = 'Sandcastle-pw-123456';
  const created = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user!.id;
  createdUserIds.push(userId);

  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const signin = await client.auth.signInWithPassword({ email, password });
  if (signin.error) throw new Error(signin.error.message);
  return { client, userId };
}

describe.skipIf(!configured)('Auth + RLS (live Supabase)', () => {
  it('lets a signed-in user persist and read back their own rating', async () => {
    const { client, userId } = await makeSignedInUser();

    const upsert = await client
      .from('user_ratings')
      .upsert({ user_id: userId, rating: 1575, deviation: 180, volatility: 0.055 })
      .select()
      .single();
    expect(upsert.error).toBeNull();
    expect(upsert.data!.rating).toBe(1575);

    const read = await client.from('user_ratings').select('*').eq('user_id', userId).maybeSingle();
    expect(read.data!.rating).toBe(1575);
  });

  it("hides another user's rating row under RLS", async () => {
    const a = await makeSignedInUser();
    const b = await makeSignedInUser();
    await admin!
      .from('user_ratings')
      .upsert({ user_id: b.userId, rating: 1999, deviation: 100, volatility: 0.05 });

    // User A queries broadly; RLS must restrict the result to A's own rows.
    const visible = await a.client.from('user_ratings').select('user_id');
    expect(visible.error).toBeNull();
    expect((visible.data ?? []).every((row) => row.user_id === a.userId)).toBe(true);
  });

  it('records an attempt the user owns and can read it back', async () => {
    const { client, userId } = await makeSignedInUser();
    // A real puzzle id (public read) to satisfy the attempts FK.
    const puzzle = await client.from('puzzles').select('id').limit(1).maybeSingle();
    expect(puzzle.error).toBeNull();
    if (!puzzle.data) return; // empty bank — nothing to reference

    const insert = await client
      .from('attempts')
      .insert({
        user_id: userId,
        puzzle_id: puzzle.data.id,
        user_line: [{ rotation: 0, col: 0 }],
        solved: true,
        rating_after: 1575,
      })
      .select()
      .single();
    expect(insert.error).toBeNull();

    const mine = await client.from('attempts').select('*').eq('user_id', userId);
    expect(mine.data).toHaveLength(1);
    expect(mine.data![0].solved).toBe(true);
  });
});
