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
const createdSubmissionIds: string[] = [];
const createdStoragePaths: string[] = [];

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
  for (const id of createdSubmissionIds) {
    await client.from('submissions').delete().eq('id', id);
  }
  if (createdStoragePaths.length) {
    await client.storage.from('submissions').remove(createdStoragePaths);
  }
});

const sampleLine: Line = [
  { rotation: 0, col: 0 },
  { rotation: 1, col: 3 },
];

/**
 * A short wait between attempt inserts in ordering-sensitive tests, so each row
 * lands on a strictly later `created_at` (now() has µs resolution but two rapid
 * inserts can otherwise tie and flip the order).
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

describe.skipIf(!configured)('DataAccess (live Supabase)', () => {
  it('round-trips a puzzle: insert then read back by id', async () => {
    const board = encodeBoard(emptyBoard());
    const colors = '1'.repeat(200);
    // A combo entry carries the v2 canonical boardKey (#38/#42).
    const combos = {
      entries: [
        { rot1: 0, col1: 0, rot2: 1, col2: 3, score: 100, boardKey: '1'.repeat(200) },
        { rot1: 0, col1: 1, rot2: 0, col2: 4, score: 62.5, boardKey: '0'.repeat(200) },
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
      tags: ['tetris-ready', 'tuck', 'avoid-s-dependency'],
      acceptCount: 4,
      margin: 12.5,
    });
    createdPuzzleIds.push(inserted.id);

    expect(inserted.glicko.rating).toBe(SEED_RATING);

    const fetched = await db!.getPuzzle(inserted.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.board).toBe(board);
    expect(fetched!.piece1).toBe('T');
    expect(fetched!.optimalLine).toEqual(sampleLine);
    expect(fetched!.optimalMetrics.holes).toBe(0);
    // The colour grid and combo table (#28/#33) round-trip intact, including the
    // v2 boardKey on each entry (#38).
    expect(fetched!.colors).toBe(colors);
    expect(fetched!.combos).toEqual(combos);
    // The puzzle type-tags (#82) round-trip intact.
    expect(fetched!.tags).toEqual(['tetris-ready', 'tuck', 'avoid-s-dependency']);
    // The v2 difficulty columns (#38) round-trip.
    expect(fetched!.acceptCount).toBe(4);
    expect(fetched!.margin).toBe(12.5);
  });

  it('auto-assigns a stable number to new puzzles and fetches by it (#49)', async () => {
    const inserted = await db!.insertPuzzle({
      board: encodeBoard(emptyBoard()),
      piece1: 'S',
      piece2: 'Z',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
    });
    createdPuzzleIds.push(inserted.id);

    // The numbering migration's sequence default assigns a fresh number on insert.
    expect(typeof inserted.number).toBe('number');
    expect(inserted.number!).toBeGreaterThan(0);

    const byNumber = await db!.getPuzzleByNumber(inserted.number!);
    expect(byNumber).not.toBeNull();
    expect(byNumber!.id).toBe(inserted.id);
    expect(byNumber!.number).toBe(inserted.number);

    // A number that does not exist falls back to null (caller → matchmaking).
    expect(await db!.getPuzzleByNumber(2_000_000_000)).toBeNull();
  });

  it('defaults the v2 difficulty columns to null for a puzzle without them', async () => {
    const puzzle = await db!.insertPuzzle({
      board: encodeBoard(emptyBoard()),
      piece1: 'J',
      piece2: 'T',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
    });
    createdPuzzleIds.push(puzzle.id);

    const fetched = await db!.getPuzzle(puzzle.id);
    expect(fetched!.acceptCount).toBeNull();
    expect(fetched!.margin).toBeNull();
    // A puzzle inserted without tags reads back as an empty array (#82 default).
    expect(fetched!.tags).toEqual([]);
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

  it('upserts a 1–5 star rating (one row per user) and aggregates community stats (#80)', async () => {
    const puzzle = await db!.insertPuzzle({
      board: encodeBoard(emptyBoard()),
      piece1: 'O',
      piece2: 'I',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
    });
    createdPuzzleIds.push(puzzle.id);

    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();

    // No rating yet, no community stats.
    expect(await db!.getMyStarRating(userA, puzzle.id)).toBeNull();
    expect(await db!.getStarStats(puzzle.id)).toEqual({ avg: 0, count: 0 });

    // A rates 4; B rates 2 → avg 3, count 2.
    await db!.upsertStarRating(userA, puzzle.id, 4);
    await db!.upsertStarRating(userB, puzzle.id, 2);
    expect(await db!.getMyStarRating(userA, puzzle.id)).toBe(4);
    expect(await db!.getStarStats(puzzle.id)).toEqual({ avg: 3, count: 2 });

    // A re-rates 5 — ONE row per user, so count stays 2 and the avg moves to 3.5.
    await db!.upsertStarRating(userA, puzzle.id, 5);
    expect(await db!.getMyStarRating(userA, puzzle.id)).toBe(5);
    expect(await db!.getStarStats(puzzle.id)).toEqual({ avg: 3.5, count: 2 });
  });

  it('derives the miss set (attempted, never solved) oldest-first and exits on solve (#75)', async () => {
    const made = [];
    for (const [p1, p2] of [
      ['T', 'L'],
      ['J', 'S'],
    ] as const) {
      const puzzle = await db!.insertPuzzle({
        board: encodeBoard(emptyBoard()),
        piece1: p1,
        piece2: p2,
        optimalLine: sampleLine,
        optimalMetrics: boardMetrics(emptyBoard()),
      });
      createdPuzzleIds.push(puzzle.id);
      made.push(puzzle);
    }
    const [p1, p2] = made;
    const userId = crypto.randomUUID();

    // Miss p1, then miss p2 → both are misses, p1 first (oldest). Spaced so
    // created_at strictly increases (stable oldest-first order).
    await db!.insertAttempt({ userId, puzzleId: p1.id, userLine: sampleLine, solved: false });
    await tick();
    await db!.insertAttempt({ userId, puzzleId: p2.id, userLine: sampleLine, solved: false });
    expect(await db!.getMissPuzzleIds(userId)).toEqual([p1.id, p2.id]);

    // Finally solve p1 → it leaves the set; p2 remains.
    await tick();
    await db!.insertAttempt({ userId, puzzleId: p1.id, userLine: sampleLine, solved: true });
    expect(await db!.getMissPuzzleIds(userId)).toEqual([p2.id]);
  });

  it('counts live community solve stats for a puzzle (#79)', async () => {
    const puzzle = await db!.insertPuzzle({
      board: encodeBoard(emptyBoard()),
      piece1: 'L',
      piece2: 'J',
      optimalLine: sampleLine,
      optimalMetrics: boardMetrics(emptyBoard()),
    });
    createdPuzzleIds.push(puzzle.id);

    // No attempts yet: 0 of 0.
    expect(await db!.getPuzzleSolveStats(puzzle.id)).toEqual({ total: 0, solved: 0 });

    // Three attempts by distinct users: two solved (A+), one not.
    for (const solved of [true, true, false]) {
      await db!.insertAttempt({
        userId: crypto.randomUUID(),
        puzzleId: puzzle.id,
        userLine: sampleLine,
        solved,
        score: solved ? 99 : 70,
      });
    }
    expect(await db!.getPuzzleSolveStats(puzzle.id)).toEqual({ total: 3, solved: 2 });
  });

  it('derives the persistent anti-repeat window from attempts (#74)', async () => {
    // Three puzzles; the user attempts p1, p2, p3, then re-attempts p1.
    const made = [];
    for (const [p1, p2] of [
      ['T', 'L'],
      ['J', 'S'],
      ['Z', 'O'],
    ] as const) {
      const puzzle = await db!.insertPuzzle({
        board: encodeBoard(emptyBoard()),
        piece1: p1,
        piece2: p2,
        optimalLine: sampleLine,
        optimalMetrics: boardMetrics(emptyBoard()),
      });
      createdPuzzleIds.push(puzzle.id);
      made.push(puzzle);
    }
    const [p1, p2, p3] = made;

    const userId = crypto.randomUUID();
    // Insert in order, spacing each so created_at strictly increases. Re-attempt
    // p1 last so it surfaces newest.
    for (const pz of [p1, p2, p3, p1]) {
      await db!.insertAttempt({ userId, puzzleId: pz.id, userLine: sampleLine, solved: false });
      await tick();
    }

    const window = await db!.getRecentAttemptedPuzzleIds(userId);
    // Distinct, newest-first: p1 (re-attempted last) then p3, p2.
    expect(window).toEqual([p1.id, p3.id, p2.id]);

    // Survives "reload": the same userId yields the same exclusion set.
    expect(await db!.getRecentAttemptedPuzzleIds(userId)).toEqual(window);

    // The limit caps the window (oldest distinct ids fall out).
    expect(await db!.getRecentAttemptedPuzzleIds(userId, 2)).toEqual([p1.id, p3.id]);
  });

  it('uploads a submission image and enqueues + processes a submission (#45/#67)', async () => {
    const submitter = crypto.randomUUID();
    // Valid PNG magic so the magic-byte check (#67) passes.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

    // Client side: upload the image (the path is server-generated, #67), then
    // enqueue the pending row pointing at the returned path.
    const path = await db!.uploadSubmissionImage(submitter, bytes);
    createdStoragePaths.push(path);
    expect(path).toMatch(new RegExp(`^${submitter}/.+\\.png$`));
    const enqueued = await db!.insertSubmission({ imagePath: path, submitter });
    createdSubmissionIds.push(enqueued.id);
    expect(enqueued.status).toBe('pending');
    expect(enqueued.imagePath).toBe(path);

    // Offline side: it shows up in the pending queue and the image reads back.
    const pending = await db!.listPendingSubmissions();
    expect(pending.some((s) => s.id === enqueued.id)).toBe(true);
    const downloaded = await db!.downloadSubmissionImage(path);
    expect(Array.from(downloaded)).toEqual(Array.from(bytes));

    // Status flips to banked with a parsed result attached.
    await db!.updateSubmission(enqueued.id, {
      status: 'banked',
      reason: null,
      parsed: { puzzleId: 'p-1' },
    });
    const afterPending = await db!.listPendingSubmissions();
    expect(afterPending.some((s) => s.id === enqueued.id)).toBe(false);
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
