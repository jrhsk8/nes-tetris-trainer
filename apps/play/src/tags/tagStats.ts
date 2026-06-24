/**
 * Per-type accuracy (#86): aggregate a player's own rated attempts by puzzle
 * type-tag, so the Account view can surface which types they are weakest at.
 *
 * Pure and Supabase-free: it takes `{ tags, solved }` rows (rated mainline
 * attempts joined to their puzzle's tags) and returns one stat per tag. A
 * multi-tag puzzle counts toward EACH of its tags. Drill-mode attempts don't
 * exist (#85 writes none), so they're naturally excluded upstream.
 */

import type { PuzzleTag } from '@trainer/core';

/** Per-tag accuracy: attempts, solves, and the solve-rate in `[0, 1]`. */
export interface TagStat {
  tag: PuzzleTag;
  attempts: number;
  solved: number;
  solveRate: number;
}

/** One rated attempt's contribution: the puzzle's tags + whether it was solved. */
export interface TaggedAttempt {
  tags: readonly PuzzleTag[];
  solved: boolean;
}

/**
 * Per-tag solve-rate over `attempts`, **weakest first** (lowest solve-rate, ties
 * broken by more attempts). A multi-tag puzzle counts toward each of its tags;
 * an attempt with no tags contributes to nothing.
 */
export function perTypeStats(attempts: readonly TaggedAttempt[]): TagStat[] {
  const acc = new Map<PuzzleTag, { attempts: number; solved: number }>();
  for (const a of attempts) {
    for (const tag of a.tags) {
      const s = acc.get(tag) ?? { attempts: 0, solved: 0 };
      s.attempts += 1;
      if (a.solved) s.solved += 1;
      acc.set(tag, s);
    }
  }
  return [...acc.entries()]
    .map(([tag, s]) => ({
      tag,
      attempts: s.attempts,
      solved: s.solved,
      solveRate: s.attempts > 0 ? s.solved / s.attempts : 0,
    }))
    .sort((a, b) => a.solveRate - b.solveRate || b.attempts - a.attempts);
}
