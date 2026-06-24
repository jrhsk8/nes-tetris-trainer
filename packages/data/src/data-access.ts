/**
 * Typed data-access layer (#2) — the only way the app and generator touch
 * Supabase. It maps Postgres rows to/from the domain types and hides the table
 * shapes. Construct it with a Supabase client (anon key in the browser,
 * service-role key in the offline generator).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isPiece, type Piece } from '@trainer/core';
import { sniffImageMime, extensionFor, MAX_UPLOAD_BYTES } from './image-sniff.js';
import { selectMatchmadePuzzle, distinctRecent, type MatchmakeOptions } from './matchmaking.js';
import { missPuzzleIds } from './misses.js';
import type {
  Attempt,
  AttemptHistoryEntry,
  AttemptRow,
  Glicko,
  NewAttempt,
  NewPuzzle,
  NewSubmission,
  Puzzle,
  PuzzleRow,
  Submission,
  SubmissionRow,
  SubmissionStatus,
  UserPrefs,
  UserPrefsRow,
  UserRating,
  UserRatingRow,
} from './types.js';

/** Flat seed rating every player and puzzle starts at (.claude/docs/PRD-v1.md "Rating"). */
export const SEED_RATING = 1500;

/**
 * The persistent anti-repeat window size (#74): the 200 most-recently-attempted
 * distinct puzzles are excluded from matchmaking so the same puzzles do not
 * recur across sessions. ~20% of the ~1003-puzzle bank, so the finite bank still
 * cycles oldest-first (.claude/docs/decisions.md 2026-06-23, grill-with-docs #7).
 */
export const RECENT_PUZZLE_WINDOW = 200;
/** Seed rating deviation. */
export const SEED_DEVIATION = 350;
/** Seed rating volatility. */
export const SEED_VOLATILITY = 0.06;

/**
 * Create a Supabase client. Session persistence is OFF by default so the
 * generator and tests stay stateless; the play app's auth flow (#13) opts in
 * with `{ persistSession: true }` so a signed-in session survives reloads and
 * is portable across devices.
 */
export function createSupabaseClient(
  url: string,
  key: string,
  options: { persistSession?: boolean } = {},
): SupabaseClient {
  const persist = options.persistSession ?? false;
  return createClient(url, key, {
    auth: { persistSession: persist, autoRefreshToken: persist },
  });
}

function asPiece(value: string, field: string): Piece {
  if (!isPiece(value)) throw new Error(`invalid piece in ${field}: ${value}`);
  return value;
}

function rowToPuzzle(row: PuzzleRow): Puzzle {
  return {
    id: row.id,
    number: row.number ?? null,
    board: row.board,
    piece1: asPiece(row.piece1, 'piece1'),
    piece2: asPiece(row.piece2, 'piece2'),
    optimalLine: row.optimal_line,
    optimalMetrics: row.optimal_metrics,
    glicko: { rating: row.rating, deviation: row.deviation, volatility: row.volatility },
    colors: row.colors ?? '',
    combos: row.combos ?? { entries: [], total: 0 },
    tags: (row.tags ?? []) as Puzzle['tags'],
    acceptCount: row.accept_count ?? null,
    margin: row.margin ?? null,
    firstValues: row.first_values ?? [],
    secondValues: row.second_values ?? [],
  };
}

function rowToUserRating(row: UserRatingRow): UserRating {
  return {
    userId: row.user_id,
    rating: row.rating,
    deviation: row.deviation,
    volatility: row.volatility,
  };
}

function rowToAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    userId: row.user_id,
    puzzleId: row.puzzle_id,
    userLine: row.user_line,
    solved: row.solved,
    score: row.score ?? null,
    ratingAfter: row.rating_after,
    createdAt: row.created_at,
  };
}

function rowToUserPrefs(row: UserPrefsRow): UserPrefs {
  return { userId: row.user_id, bindings: row.bindings, muted: row.muted ?? false };
}

function rowToSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    imagePath: row.image_path,
    submitter: row.submitter,
    status: row.status,
    reason: row.reason,
    parsed: row.parsed,
    createdAt: row.created_at,
  };
}

/** The Storage bucket holding uploaded submission screenshots (#45). */
export const SUBMISSIONS_BUCKET = 'submissions';

/** The data-access surface shared by the play app and the generator. */
export interface DataAccess {
  getPuzzle(id: string): Promise<Puzzle | null>;
  /** Fetch a puzzle by its stable human-friendly number (#49); null if absent. */
  getPuzzleByNumber(number: number): Promise<Puzzle | null>;
  getRandomPuzzle(): Promise<Puzzle | null>;
  /**
   * Matchmaking selection (#44): a puzzle near the player's rating, excluding
   * the recently-seen cooldown ids, auto-widening the band if too few qualify.
   */
  getMatchmadePuzzle(opts: MatchmakeOptions): Promise<Puzzle | null>;
  countPuzzles(): Promise<number>;
  insertPuzzle(puzzle: NewPuzzle): Promise<Puzzle>;
  insertPuzzles(puzzles: NewPuzzle[]): Promise<Puzzle[]>;
  /** Delete every puzzle (and, by cascade, every attempt). Used by a bank regen. */
  deleteAllPuzzles(): Promise<number>;
  /** Every puzzle's id + rating (the lean read the offline rating tally needs). */
  getAllPuzzleRatings(): Promise<{ id: string; glicko: Glicko }[]>;
  /** Overwrite one puzzle's Glicko rating (offline tally, #41). */
  updatePuzzleRating(id: string, glicko: Glicko): Promise<void>;
  getUserRating(userId: string): Promise<UserRating | null>;
  /** Every persisted player rating (opponents for the offline puzzle-rating tally). */
  getAllUserRatings(): Promise<UserRating[]>;
  upsertUserRating(rating: UserRating): Promise<UserRating>;
  insertAttempt(attempt: NewAttempt): Promise<Attempt>;
  /** Every recorded attempt across all players (the offline tally substrate). */
  getAllAttempts(): Promise<Attempt[]>;
  getUserAttempts(userId: string): Promise<Attempt[]>;
  getUserAttemptHistory(userId: string): Promise<AttemptHistoryEntry[]>;
  /**
   * Live community solve stats for a puzzle (#79): `{ total, solved }` over the
   * `attempts` table, where `solved` counts attempts with `solved = true` (an
   * A+, score ≥ 97 — the "correct" line). Two count queries, computed at results
   * time so the player's own just-recorded attempt is included — a brand-new
   * puzzle honestly reads `100% (1)`. The results panel renders this as
   * `X% (N)` correct.
   */
  getPuzzleSolveStats(puzzleId: string): Promise<{ total: number; solved: number }>;
  /**
   * Upsert this user's 1–5 star "how fun" rating for a puzzle (#80): one row per
   * `(user, puzzle)`, changeable. RLS own-row insert/update (anonymous allowed).
   */
  upsertStarRating(userId: string, puzzleId: string, stars: number): Promise<void>;
  /** This user's own star rating for a puzzle (#80), or null if not yet rated. */
  getMyStarRating(userId: string, puzzleId: string): Promise<number | null>;
  /**
   * Community star stats for a puzzle (#80): `{ avg, count }` across every user's
   * rating, via a SECURITY DEFINER aggregate (no individual row exposed). The UI
   * reveals this only AFTER the player has rated.
   */
  getStarStats(puzzleId: string): Promise<{ avg: number; count: number }>;
  /**
   * The persistent anti-repeat window (#74): the most recently-attempted
   * DISTINCT puzzle ids for this user, newest-first, capped at `limit`
   * (default {@link RECENT_PUZZLE_WINDOW}). Derived live from `attempts` — no
   * new schema — so it survives reloads (same `userId` ⇒ same exclusion set) and
   * goes cross-device once account linking lands (#77). Fed to
   * {@link getMatchmadePuzzle} as `recentIds`.
   */
  getRecentAttemptedPuzzleIds(userId: string, limit?: number): Promise<string[]>;
  /**
   * The miss set (#75): puzzle ids this user has attempted ≥1 time but never
   * solved, **oldest-first** (by earliest attempt). Derived live from `attempts`
   * (own rows under RLS). A puzzle leaves the set once solved. Feeds both the
   * Review-misses mode and the ~1-in-10 auto-injection in normal play.
   */
  getMissPuzzleIds(userId: string): Promise<string[]>;
  getUserPrefs(userId: string): Promise<UserPrefs | null>;
  upsertUserPrefs(prefs: UserPrefs): Promise<UserPrefs>;
  /**
   * Upload a submission screenshot to Storage (client, #45/#67). The storage
   * path and content-type are SERVER-generated here, not chosen by the caller: a
   * per-user-prefixed `${userId}/<uuid>.<ext>` path with the content-type sniffed
   * from the bytes' magic number. Rejects anything over {@link MAX_UPLOAD_BYTES}
   * or that is not a PNG/JPEG. Returns the generated path to enqueue.
   */
  uploadSubmissionImage(userId: string, bytes: Uint8Array): Promise<string>;
  /** Download a submission screenshot from Storage (offline pipeline, #45). */
  downloadSubmissionImage(path: string): Promise<Uint8Array>;
  /** Enqueue a screenshot submission as `pending` (client, #45). */
  insertSubmission(submission: NewSubmission): Promise<Submission>;
  /** Every `pending` submission, oldest first (offline pipeline, #45). */
  listPendingSubmissions(): Promise<Submission[]>;
  /** Flip a submission's status, attaching a reason and/or parsed result (#45). */
  updateSubmission(
    id: string,
    patch: { status: SubmissionStatus; reason?: string | null; parsed?: unknown },
  ): Promise<void>;
  /**
   * Dev curation (#72): is this user an allowlisted curator? Self-detected via
   * the `curators` table under RLS (a user reads only their own row). Returns
   * false when not allowlisted (the empty-safe default), so the UI hides the
   * curation controls for everyone until a curator is configured.
   *
   * ADD A CURATOR LATER — a pure data step, NO code change and NO deploy: insert
   * one row into `public.curators` keyed by the account's `auth.uid()` (see
   * schema.sql for the exact SQL). The allowlist is the only thing to edit; no
   * UID is hardcoded. With the table empty, `isCurator` is false for everyone and
   * every curation write is RLS-denied, so the rest of the app is unaffected.
   */
  isCurator(userId: string): Promise<boolean>;
  /**
   * Flag a puzzle with a free-text comment (#72): appends a `flag` row to the
   * append-only `puzzle_flags` log for later pattern-mining. The puzzle stays
   * live. RLS rejects non-curators regardless of client.
   */
  flagPuzzle(input: { puzzleId: string; userId: string; comment: string }): Promise<void>;
  /**
   * Soft-delete (cull) a puzzle (#72): appends a `cull` row (optional reason) and
   * sets `active = false`, so matchmaking stops serving it. Reversible via
   * {@link setPuzzleActive}; the row, combos, and attempts survive.
   */
  cullPuzzle(input: { puzzleId: string; userId: string; reason?: string }): Promise<void>;
  /** Restore (un-cull) or re-hide a puzzle by setting `active` (#72 undo). */
  setPuzzleActive(puzzleId: string, active: boolean): Promise<void>;
}

function newPuzzleToRow(puzzle: NewPuzzle): Record<string, unknown> {
  const row: Record<string, unknown> = {
    board: puzzle.board,
    piece1: puzzle.piece1,
    piece2: puzzle.piece2,
    optimal_line: puzzle.optimalLine,
    optimal_metrics: puzzle.optimalMetrics,
  };
  if (puzzle.glicko?.rating !== undefined) row.rating = puzzle.glicko.rating;
  if (puzzle.glicko?.deviation !== undefined) row.deviation = puzzle.glicko.deviation;
  if (puzzle.glicko?.volatility !== undefined) row.volatility = puzzle.glicko.volatility;
  if (puzzle.colors !== undefined) row.colors = puzzle.colors;
  if (puzzle.combos !== undefined) row.combos = puzzle.combos;
  if (puzzle.tags !== undefined) row.tags = puzzle.tags;
  if (puzzle.acceptCount !== undefined) row.accept_count = puzzle.acceptCount;
  if (puzzle.margin !== undefined) row.margin = puzzle.margin;
  if (puzzle.firstValues !== undefined) row.first_values = puzzle.firstValues;
  if (puzzle.secondValues !== undefined) row.second_values = puzzle.secondValues;
  return row;
}

/** Build a {@link DataAccess} over a Supabase client. */
export function createDataAccess(client: SupabaseClient): DataAccess {
  async function getPuzzle(id: string): Promise<Puzzle | null> {
    const { data, error } = await client.from('puzzles').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getPuzzle failed: ${error.message}`);
    return data ? rowToPuzzle(data as PuzzleRow) : null;
  }

  async function getPuzzleByNumber(number: number): Promise<Puzzle | null> {
    const { data, error } = await client
      .from('puzzles')
      .select('*')
      .eq('number', number)
      .maybeSingle();
    if (error) throw new Error(`getPuzzleByNumber failed: ${error.message}`);
    return data ? rowToPuzzle(data as PuzzleRow) : null;
  }

  async function countPuzzles(): Promise<number> {
    const { count, error } = await client
      .from('puzzles')
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error(`countPuzzles failed: ${error.message}`);
    return count ?? 0;
  }

  async function getRandomPuzzle(): Promise<Puzzle | null> {
    const total = await countPuzzles();
    if (total === 0) return null;
    const offset = Math.floor(Math.random() * total);
    const { data, error } = await client
      .from('puzzles')
      .select('*')
      .eq('active', true) // skip soft-deleted (culled) puzzles (#72)
      .order('created_at', { ascending: true })
      .range(offset, offset);
    if (error) throw new Error(`getRandomPuzzle failed: ${error.message}`);
    const rows = (data ?? []) as PuzzleRow[];
    return rows.length > 0 ? rowToPuzzle(rows[0]) : null;
  }

  async function getMatchmadePuzzle(opts: MatchmakeOptions): Promise<Puzzle | null> {
    const exclude = opts.recentIds ?? [];
    return selectMatchmadePuzzle(async (min, max) => {
      let query = client
        .from('puzzles')
        .select('*')
        .eq('active', true) // skip soft-deleted (culled) puzzles (#72)
        .gte('rating', min)
        .lte('rating', max);
      // One query delivers rating-match + anti-repeat: drop the cooldown ids
      // in-band too (the helper re-filters as a safety net).
      if (exclude.length > 0) query = query.not('id', 'in', `(${exclude.join(',')})`);
      const { data, error } = await query;
      if (error) throw new Error(`getMatchmadePuzzle failed: ${error.message}`);
      return (data ?? []).map((row) => rowToPuzzle(row as PuzzleRow));
    }, opts);
  }

  async function insertPuzzles(puzzles: NewPuzzle[]): Promise<Puzzle[]> {
    if (puzzles.length === 0) return [];
    const { data, error } = await client
      .from('puzzles')
      .insert(puzzles.map(newPuzzleToRow))
      .select('*');
    if (error) throw new Error(`insertPuzzles failed: ${error.message}`);
    return (data as PuzzleRow[]).map(rowToPuzzle);
  }

  async function insertPuzzle(puzzle: NewPuzzle): Promise<Puzzle> {
    const [inserted] = await insertPuzzles([puzzle]);
    return inserted;
  }

  async function deleteAllPuzzles(): Promise<number> {
    // Delete every row; attempts cascade-delete via their FK. The
    // `not is null` predicate matches all rows (id is never null) and
    // satisfies supabase-js's requirement that a delete carry a filter.
    const { data, error } = await client
      .from('puzzles')
      .delete()
      .not('id', 'is', null)
      .select('id');
    if (error) throw new Error(`deleteAllPuzzles failed: ${error.message}`);
    return (data ?? []).length;
  }

  async function getAllPuzzleRatings(): Promise<{ id: string; glicko: Glicko }[]> {
    const { data, error } = await client
      .from('puzzles')
      .select('id, rating, deviation, volatility');
    if (error) throw new Error(`getAllPuzzleRatings failed: ${error.message}`);
    return (data ?? []).map((row) => {
      const r = row as Pick<PuzzleRow, 'id' | 'rating' | 'deviation' | 'volatility'>;
      return {
        id: r.id,
        glicko: { rating: r.rating, deviation: r.deviation, volatility: r.volatility },
      };
    });
  }

  async function updatePuzzleRating(id: string, glicko: Glicko): Promise<void> {
    const { error } = await client
      .from('puzzles')
      .update({
        rating: glicko.rating,
        deviation: glicko.deviation,
        volatility: glicko.volatility,
      })
      .eq('id', id);
    if (error) throw new Error(`updatePuzzleRating failed: ${error.message}`);
  }

  async function getUserRating(userId: string): Promise<UserRating | null> {
    const { data, error } = await client
      .from('user_ratings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`getUserRating failed: ${error.message}`);
    return data ? rowToUserRating(data as UserRatingRow) : null;
  }

  async function upsertUserRating(rating: UserRating): Promise<UserRating> {
    const { data, error } = await client
      .from('user_ratings')
      .upsert(
        {
          user_id: rating.userId,
          rating: rating.rating,
          deviation: rating.deviation,
          volatility: rating.volatility,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`upsertUserRating failed: ${error.message}`);
    return rowToUserRating(data as UserRatingRow);
  }

  async function getAllUserRatings(): Promise<UserRating[]> {
    const { data, error } = await client.from('user_ratings').select('*');
    if (error) throw new Error(`getAllUserRatings failed: ${error.message}`);
    return (data as UserRatingRow[]).map(rowToUserRating);
  }

  async function insertAttempt(attempt: NewAttempt): Promise<Attempt> {
    const { data, error } = await client
      .from('attempts')
      .insert({
        user_id: attempt.userId,
        puzzle_id: attempt.puzzleId,
        user_line: attempt.userLine,
        solved: attempt.solved,
        score: attempt.score ?? null,
        rating_after: attempt.ratingAfter ?? null,
      })
      .select('*')
      .single();
    if (error) throw new Error(`insertAttempt failed: ${error.message}`);
    return rowToAttempt(data as AttemptRow);
  }

  async function getAllAttempts(): Promise<Attempt[]> {
    const { data, error } = await client
      .from('attempts')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`getAllAttempts failed: ${error.message}`);
    return (data as AttemptRow[]).map(rowToAttempt);
  }

  async function getUserAttempts(userId: string): Promise<Attempt[]> {
    const { data, error } = await client
      .from('attempts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`getUserAttempts failed: ${error.message}`);
    return (data as AttemptRow[]).map(rowToAttempt);
  }

  async function getUserAttemptHistory(userId: string): Promise<AttemptHistoryEntry[]> {
    // Join each attempt to its puzzle's rating (difficulty). The puzzle is
    // null for an orphaned attempt (its puzzle was removed by a bank regen).
    const { data, error } = await client
      .from('attempts')
      .select('*, puzzles(rating)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`getUserAttemptHistory failed: ${error.message}`);
    const rows = (data ?? []) as (AttemptRow & { puzzles: { rating: number } | null })[];
    return rows.map((row) => ({ ...rowToAttempt(row), difficulty: row.puzzles?.rating ?? null }));
  }

  async function getPuzzleSolveStats(
    puzzleId: string,
  ): Promise<{ total: number; solved: number }> {
    // Community-wide, so it must aggregate across all users' attempts — but the
    // attempts table is own-row RLS, so a direct count under the anon key would
    // see only the caller's rows. The SECURITY DEFINER `puzzle_solve_stats`
    // function returns the aggregate past RLS without exposing any row (#79).
    const { data, error } = await client.rpc('puzzle_solve_stats', { p_puzzle_id: puzzleId });
    if (error) throw new Error(`getPuzzleSolveStats failed: ${error.message}`);
    const row = (data as { total: number; solved: number }[] | null)?.[0];
    return { total: Number(row?.total ?? 0), solved: Number(row?.solved ?? 0) };
  }

  async function upsertStarRating(
    userId: string,
    puzzleId: string,
    stars: number,
  ): Promise<void> {
    const { error } = await client.from('puzzle_star_ratings').upsert(
      {
        user_id: userId,
        puzzle_id: puzzleId,
        stars,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,puzzle_id' },
    );
    if (error) throw new Error(`upsertStarRating failed: ${error.message}`);
  }

  async function getMyStarRating(userId: string, puzzleId: string): Promise<number | null> {
    const { data, error } = await client
      .from('puzzle_star_ratings')
      .select('stars')
      .eq('user_id', userId)
      .eq('puzzle_id', puzzleId)
      .maybeSingle();
    if (error) throw new Error(`getMyStarRating failed: ${error.message}`);
    return data ? (data as { stars: number }).stars : null;
  }

  async function getStarStats(puzzleId: string): Promise<{ avg: number; count: number }> {
    const { data, error } = await client.rpc('puzzle_star_stats', { p_puzzle_id: puzzleId });
    if (error) throw new Error(`getStarStats failed: ${error.message}`);
    const row = (data as { avg: number; count: number }[] | null)?.[0];
    return { avg: Number(row?.avg ?? 0), count: Number(row?.count ?? 0) };
  }

  async function getRecentAttemptedPuzzleIds(
    userId: string,
    limit: number = RECENT_PUZZLE_WINDOW,
  ): Promise<string[]> {
    // Fetch a generous batch of the newest attempt rows (one per attempt, with
    // repeats) and dedupe in memory to the `limit` most-recent distinct puzzles.
    // The 5× over-fetch comfortably surfaces `limit` distinct ids for any
    // realistic replay rate without scanning the player's whole history.
    const { data, error } = await client
      .from('attempts')
      .select('puzzle_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit * 5);
    if (error) throw new Error(`getRecentAttemptedPuzzleIds failed: ${error.message}`);
    const ids = (data ?? []).map((r) => (r as { puzzle_id: string }).puzzle_id);
    return distinctRecent(ids, limit);
  }

  async function getMissPuzzleIds(userId: string): Promise<string[]> {
    const { data, error } = await client
      .from('attempts')
      .select('puzzle_id, solved, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`getMissPuzzleIds failed: ${error.message}`);
    const rows = (data ?? []) as { puzzle_id: string; solved: boolean }[];
    return missPuzzleIds(rows.map((r) => ({ puzzleId: r.puzzle_id, solved: r.solved })));
  }

  async function getUserPrefs(userId: string): Promise<UserPrefs | null> {
    const { data, error } = await client
      .from('user_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`getUserPrefs failed: ${error.message}`);
    return data ? rowToUserPrefs(data as UserPrefsRow) : null;
  }

  async function upsertUserPrefs(prefs: UserPrefs): Promise<UserPrefs> {
    const { data, error } = await client
      .from('user_prefs')
      .upsert(
        {
          user_id: prefs.userId,
          bindings: prefs.bindings,
          muted: prefs.muted ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`upsertUserPrefs failed: ${error.message}`);
    return rowToUserPrefs(data as UserPrefsRow);
  }

  async function uploadSubmissionImage(userId: string, bytes: Uint8Array): Promise<string> {
    // Hardening (#67): reject oversize/non-image bytes BEFORE upload, and
    // server-generate the path + content-type so a client can neither choose its
    // storage location (it is pinned under its own `auth.uid()` prefix, which the
    // storage policy enforces) nor mislabel the content-type.
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(`uploadSubmissionImage failed: image exceeds ${MAX_UPLOAD_BYTES} bytes`);
    }
    const mime = sniffImageMime(bytes);
    if (!mime) {
      throw new Error('uploadSubmissionImage failed: not a PNG or JPEG image');
    }
    const path = `${userId}/${crypto.randomUUID()}.${extensionFor(mime)}`;
    const { error } = await client.storage
      .from(SUBMISSIONS_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (error) throw new Error(`uploadSubmissionImage failed: ${error.message}`);
    return path;
  }

  async function downloadSubmissionImage(path: string): Promise<Uint8Array> {
    const { data, error } = await client.storage.from(SUBMISSIONS_BUCKET).download(path);
    if (error || !data) throw new Error(`downloadSubmissionImage failed: ${error?.message}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async function insertSubmission(submission: NewSubmission): Promise<Submission> {
    const { data, error } = await client
      .from('submissions')
      .insert({
        image_path: submission.imagePath,
        submitter: submission.submitter,
        status: 'pending',
      })
      .select('*')
      .single();
    if (error) throw new Error(`insertSubmission failed: ${error.message}`);
    return rowToSubmission(data as SubmissionRow);
  }

  async function listPendingSubmissions(): Promise<Submission[]> {
    const { data, error } = await client
      .from('submissions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`listPendingSubmissions failed: ${error.message}`);
    return (data ?? []).map((row) => rowToSubmission(row as SubmissionRow));
  }

  async function updateSubmission(
    id: string,
    patch: { status: SubmissionStatus; reason?: string | null; parsed?: unknown },
  ): Promise<void> {
    const row: Record<string, unknown> = { status: patch.status };
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.parsed !== undefined) row.parsed = patch.parsed;
    const { error } = await client.from('submissions').update(row).eq('id', id);
    if (error) throw new Error(`updateSubmission failed: ${error.message}`);
  }

  async function isCurator(userId: string): Promise<boolean> {
    const { data, error } = await client
      .from('curators')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    // Empty-safe: no row (or an RLS-denied read) ⇒ not a curator. A genuine error
    // is swallowed to a `false` so a curation-table hiccup never breaks play.
    if (error) return false;
    return data !== null;
  }

  async function flagPuzzle(input: {
    puzzleId: string;
    userId: string;
    comment: string;
  }): Promise<void> {
    const { error } = await client.from('puzzle_flags').insert({
      puzzle_id: input.puzzleId,
      user_id: input.userId,
      action: 'flag',
      comment: input.comment,
    });
    if (error) throw new Error(`flagPuzzle failed: ${error.message}`);
  }

  async function setPuzzleActive(puzzleId: string, active: boolean): Promise<void> {
    const { error } = await client.from('puzzles').update({ active }).eq('id', puzzleId);
    if (error) throw new Error(`setPuzzleActive failed: ${error.message}`);
  }

  async function cullPuzzle(input: {
    puzzleId: string;
    userId: string;
    reason?: string;
  }): Promise<void> {
    const { error } = await client.from('puzzle_flags').insert({
      puzzle_id: input.puzzleId,
      user_id: input.userId,
      action: 'cull',
      comment: input.reason ?? null,
    });
    if (error) throw new Error(`cullPuzzle failed: ${error.message}`);
    await setPuzzleActive(input.puzzleId, false);
  }

  return {
    getPuzzle,
    getPuzzleByNumber,
    getRandomPuzzle,
    getMatchmadePuzzle,
    countPuzzles,
    insertPuzzle,
    insertPuzzles,
    deleteAllPuzzles,
    getAllPuzzleRatings,
    updatePuzzleRating,
    getUserRating,
    getAllUserRatings,
    upsertUserRating,
    insertAttempt,
    getAllAttempts,
    getUserAttempts,
    getUserAttemptHistory,
    getPuzzleSolveStats,
    upsertStarRating,
    getMyStarRating,
    getStarStats,
    getRecentAttemptedPuzzleIds,
    getMissPuzzleIds,
    getUserPrefs,
    upsertUserPrefs,
    uploadSubmissionImage,
    downloadSubmissionImage,
    insertSubmission,
    listPendingSubmissions,
    updateSubmission,
    isCurator,
    flagPuzzle,
    cullPuzzle,
    setPuzzleActive,
  };
}
