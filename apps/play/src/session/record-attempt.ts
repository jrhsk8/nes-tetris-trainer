import {
  gradeCombo,
  comboOutcomeKey,
  type ComboTable,
  type Grid,
  type Line,
  type Piece,
  type Placement,
} from '@trainer/core';
import type { DataAccess, Glicko } from '@trainer/data';
import { applyAttempt, attemptOutcome, seedRating, updateRatings } from '@trainer/rating';

export type RecordAttemptDb = Pick<
  DataAccess,
  | 'getUserRating'
  | 'upsertUserRating'
  | 'updatePuzzleRating'
  | 'insertAttempt'
  | 'getPuzzleSolveStats'
>;

export interface AttemptResult {
  solved: boolean;
  score: number | null;
  rating: { before: Glicko; after: Glicko; delta: number } | null;
  solveStats: { total: number; solved: number } | null;
}

export async function recordAttempt(
  db: RecordAttemptDb,
  userId: string,
  puzzle: { id: string; piece1: Piece; piece2: Piece; combos: ComboTable; glicko: Glicko },
  board0: Grid,
  userLine: readonly Placement[],
  drill = false,
): Promise<AttemptResult> {
  const line: Line = [userLine[0], userLine[1]];
  const graded = gradeCombo(
    puzzle.combos,
    line,
    comboOutcomeKey(board0, puzzle.piece1, puzzle.piece2, line),
  );

  if (drill) {
    let solveStats: { total: number; solved: number } | null = null;
    try {
      solveStats = await db.getPuzzleSolveStats(puzzle.id);
    } catch { /* best-effort */ }
    return { solved: graded.correct, score: graded.score, rating: null, solveStats };
  }

  const outcome = attemptOutcome(graded.score, graded.correct);
  let rating: { before: Glicko; after: Glicko; delta: number };
  try {
    const applied = await applyAttempt(db, userId, puzzle.glicko, outcome);
    await db.insertAttempt({
      userId,
      puzzleId: puzzle.id,
      userLine: line,
      solved: graded.correct,
      score: graded.score,
      ratingAfter: applied.after.rating,
    });
    rating = { before: applied.before, after: applied.after, delta: applied.delta };
    // Persist the puzzle's live (boosted) rating drift (#99) so puzzles filter
    // up/down in real time, like the player. Best-effort: the player update and
    // the attempt row are already committed, so a puzzle-write hiccup must not
    // undo them — the offline tally reconciles any lost/raced write later.
    try {
      await db.updatePuzzleRating(puzzle.id, applied.puzzle);
    } catch (e) {
      console.error('puzzle rating persistence failed:', e);
    }
  } catch (err) {
    console.error('attempt/rating persistence failed:', err);
    const update = updateRatings(seedRating(), puzzle.glicko, outcome);
    rating = {
      before: seedRating(),
      after: update.user,
      delta: update.user.rating - seedRating().rating,
    };
  }

  let solveStats: { total: number; solved: number } | null = null;
  try {
    solveStats = await db.getPuzzleSolveStats(puzzle.id);
  } catch { /* best-effort */ }

  return { solved: graded.correct, score: graded.score, rating, solveStats };
}
