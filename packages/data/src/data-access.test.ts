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
