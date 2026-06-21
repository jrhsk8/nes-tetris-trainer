import { describe, it, expect, afterAll } from 'vitest';
import { boardMetrics, emptyBoard, encodeBoard, type Line } from '@trainer/core';
import { createDataAccess, createSupabaseClient, SEED_RATING } from './data-access.js';

// Round-trip integration test (#2 acceptance) against a real Supabase instance.
// Uses the service-role key, which bypasses RLS. Skipped cleanly when the
// environment is not configured (e.g. CI without secrets).
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const configured = Boolean(url && serviceKey);

const db = configured ? createDataAccess(createSupabaseClient(url!, serviceKey!)) : null;

// Track rows we create so we can clean up regardless of assertion outcomes.
const createdPuzzleIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  if (!configured) return;
  const client = createSupabaseClient(url!, serviceKey!);
  for (const id of createdPuzzleIds) {
    // attempts cascade-delete with their puzzle.
    await client.from('puzzles').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await client.from('user_ratings').delete().eq('user_id', id);
    await client.from('user_prefs').delete().eq('user_id', id);
  }
});

const sampleLine: Line = [
  { rotation: 0, col: 0 },
  { rotation: 1, col: 3 },
];

describe.skipIf(!configured)('DataAccess (live Supabase)', () => {
  it('round-trips a puzzle: insert then read back by id', async () => {
    const board = encodeBoard(emptyBoard());
    const colors = '1'.repeat(200);
    const combos = {
      entries: [
        { rot1: 0, col1: 0, rot2: 1, col2: 3, score: 100 },
        { rot1: 0, col1: 1, rot2: 0, col2: 4, score: 62.5 },
      ],
      total: 17,
    };
    const inserted = await db!.insertPuzzle({
      board,
      piece1: 'T',
      piece2: 'L',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
      colors,
      combos,
    });
    createdPuzzleIds.push(inserted.id);

    expect(inserted.glicko.rating).toBe(SEED_RATING);

    const fetched = await db!.getPuzzle(inserted.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.board).toBe(board);
    expect(fetched!.piece1).toBe('T');
    expect(fetched!.optimalLine).toEqual(sampleLine);
    expect(fetched!.optimalMetrics.holes).toBe(0);
    // The colour grid and combo table (#28/#33) round-trip intact.
    expect(fetched!.colors).toBe(colors);
    expect(fetched!.combos).toEqual(combos);
  });

  it('selects a random puzzle from the bank', async () => {
    const random = await db!.getRandomPuzzle();
    expect(random).not.toBeNull();
    expect(await db!.countPuzzles()).toBeGreaterThan(0);
  });

  it('round-trips a user rating via upsert and read', async () => {
    const userId = crypto.randomUUID();
    createdUserIds.push(userId);

    expect(await db!.getUserRating(userId)).toBeNull();

    const saved = await db!.upsertUserRating({
      userId,
      rating: 1620,
      deviation: 180,
      volatility: 0.055,
    });
    expect(saved.rating).toBe(1620);

    const reread = await db!.getUserRating(userId);
    expect(reread).toEqual(saved);

    // Upsert again to confirm it updates rather than duplicating.
    const updated = await db!.upsertUserRating({ ...saved, rating: 1700 });
    expect(updated.rating).toBe(1700);
  });

  it('records an attempt against a puzzle and reads it back', async () => {
    const puzzle = await db!.insertPuzzle({
      board: encodeBoard(emptyBoard()),
      piece1: 'S',
      piece2: 'Z',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
    });
    createdPuzzleIds.push(puzzle.id);

    const userId = crypto.randomUUID();
    const attempt = await db!.insertAttempt({
      userId,
      puzzleId: puzzle.id,
      userLine: sampleLine,
      solved: true,
    });

    expect(attempt.solved).toBe(true);
    expect(attempt.puzzleId).toBe(puzzle.id);
    expect(typeof attempt.createdAt).toBe('string');

    const attempts = await db!.getUserAttempts(userId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].id).toBe(attempt.id);
  });

  it('reads attempt history joined with the puzzle difficulty', async () => {
    const puzzle = await db!.insertPuzzle({
      board: encodeBoard(emptyBoard()),
      piece1: 'I',
      piece2: 'O',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
      glicko: { rating: 1623 },
    });
    createdPuzzleIds.push(puzzle.id);

    const userId = crypto.randomUUID();
    await db!.insertAttempt({ userId, puzzleId: puzzle.id, userLine: sampleLine, solved: false });

    const history = await db!.getUserAttemptHistory(userId);
    expect(history).toHaveLength(1);
    expect(history[0].puzzleId).toBe(puzzle.id);
    expect(history[0].difficulty).toBe(1623);
    expect(history[0].solved).toBe(false);
  });

  it('round-trips user prefs (key bindings) via upsert and read', async () => {
    const userId = crypto.randomUUID();
    createdUserIds.push(userId);

    expect(await db!.getUserPrefs(userId)).toBeNull();

    const saved = await db!.upsertUserPrefs({
      userId,
      bindings: { 'move-left': 'ArrowLeft', 'rotate-cw': 'k' },
    });
    expect(saved.bindings['rotate-cw']).toBe('k');

    const reread = await db!.getUserPrefs(userId);
    expect(reread).toEqual(saved);

    // Upsert again to confirm it updates rather than duplicating.
    const updated = await db!.upsertUserPrefs({
      userId,
      bindings: { 'rotate-cw': 'j' },
    });
    expect(updated.bindings['rotate-cw']).toBe('j');
  });
});
