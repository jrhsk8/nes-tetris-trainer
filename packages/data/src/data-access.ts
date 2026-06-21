/**
 * Typed data-access layer (#2) — the only way the app and generator touch
 * Supabase. It maps Postgres rows to/from the domain types and hides the table
 * shapes. Construct it with a Supabase client (anon key in the browser,
 * service-role key in the offline generator).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isPiece, type Piece } from '@trainer/core';
import { selectMatchmadePuzzle, type MatchmakeOptions } from './matchmaking.js';
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

/** Flat seed rating every player and puzzle starts at (docs/PRD-v1.md "Rating"). */
export const SEED_RATING = 1500;
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
    board: row.board,
    piece1: asPiece(row.piece1, 'piece1'),
    piece2: asPiece(row.piece2, 'piece2'),
    optimalLine: row.optimal_line,
    optimalMetrics: row.optimal_metrics,
    glicko: { rating: row.rating, deviation: row.deviation, volatility: row.volatility },
    colors: row.colors ?? '',
    combos: row.combos ?? { entries: [], total: 0 },
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
    ratingAfter: row.rating_after,
    createdAt: row.created_at,
  };
}

function rowToUserPrefs(row: UserPrefsRow): UserPrefs {
  return { userId: row.user_id, bindings: row.bindings };
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
  getUserPrefs(userId: string): Promise<UserPrefs | null>;
  upsertUserPrefs(prefs: UserPrefs): Promise<UserPrefs>;
  /** Upload a submission screenshot to Storage (client, #45). */
  uploadSubmissionImage(path: string, bytes: Uint8Array, contentType?: string): Promise<void>;
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
      .order('created_at', { ascending: true })
      .range(offset, offset);
    if (error) throw new Error(`getRandomPuzzle failed: ${error.message}`);
    const rows = (data ?? []) as PuzzleRow[];
    return rows.length > 0 ? rowToPuzzle(rows[0]) : null;
  }

  async function getMatchmadePuzzle(opts: MatchmakeOptions): Promise<Puzzle | null> {
    const exclude = opts.recentIds ?? [];
    return selectMatchmadePuzzle(async (min, max) => {
      let query = client.from('puzzles').select('*').gte('rating', min).lte('rating', max);
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
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`upsertUserPrefs failed: ${error.message}`);
    return rowToUserPrefs(data as UserPrefsRow);
  }

  async function uploadSubmissionImage(
    path: string,
    bytes: Uint8Array,
    contentType = 'image/png',
  ): Promise<void> {
    const { error } = await client.storage
      .from(SUBMISSIONS_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error(`uploadSubmissionImage failed: ${error.message}`);
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

  return {
    getPuzzle,
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
    getUserPrefs,
    upsertUserPrefs,
    uploadSubmissionImage,
    downloadSubmissionImage,
    insertSubmission,
    listPendingSubmissions,
    updateSubmission,
  };
}
