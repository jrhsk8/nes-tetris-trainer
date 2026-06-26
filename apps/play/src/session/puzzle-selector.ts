/**
 * Puzzle selection (#11/#44/#75/#85/#99) — the "what do I serve next?" logic the
 * play loop ({@link PuzzlePlay}) used to inline inside a React `load` callback,
 * lifted out so it is a plain async function with no React, DOM, or rendering.
 *
 * The five modes, in priority order:
 *  1. a one-shot shared `?puzzle=N` (#49),
 *  2. **drill** — random over the selected type-tags, no rating band, no window (#85),
 *  3. **review-misses** — the player's unsolved puzzles oldest-first, no band/window (#75),
 *  4. a ~1-in-10 **due-miss** auto-injection into normal play (#75),
 *  5. **matchmaking** — a puzzle in the rating band, anti-repeat window + anti-streak (#44/#99).
 *
 * The cursors that carry across serves within a session (the anti-repeat window,
 * the anti-streak headline-type window, the drill/review served-sets, the pending
 * shared number) live in a plain {@link SelectionState} the caller owns and this
 * function advances in place — so the whole selection sequence is testable against
 * a fake db with no component to render.
 */

import {
  RECENT_PUZZLE_WINDOW,
  ANTISTREAK_WINDOW,
  SEED_RATING,
  dueMisses,
  shouldInjectMiss,
  type DataAccess,
  type Puzzle,
} from '@trainer/data';
import { dominantTag, type PuzzleTag } from '@trainer/core';

/** The read surface puzzle selection needs — the narrow seam behind which it sits. */
export type SelectorDb = Pick<
  DataAccess,
  | 'getPuzzleByNumber'
  | 'fetchPuzzlesByTags'
  | 'getMatchmadePuzzle'
  | 'getPuzzle'
  | 'getRecentAttemptedPuzzleIds'
  | 'getMissPuzzleIds'
  | 'getUserRating'
>;

/** Per-session mode + knobs; stable for the life of a selection sequence. */
export interface SelectionConfig {
  userId: string;
  /** Review-misses mode (#75): serve unsolved puzzles oldest-first, no band/window. */
  reviewMode: boolean;
  /** Non-empty ⇒ drill mode (#85) over these tags (OR), no band/window. */
  drillTags?: readonly PuzzleTag[];
  /** RNG in `[0, 1)` for the ~1-in-10 miss injection (#75); defaults to `Math.random`. */
  random?: () => number;
}

/** The mutable cursors selection carries across serves within one session. */
export interface SelectionState {
  /** A shared puzzle number to open first (#49), consumed once; else null. */
  pendingNumber: number | null;
  /** The anti-repeat window (#74): served ids newest-first, capped; hydrated lazily. */
  recent: string[];
  /** Whether {@link recent} has been hydrated from `attempts` yet this session. */
  recentLoaded: boolean;
  /** The anti-streak window (#99): served headline types newest-first, capped. */
  recentTags: string[];
  /** Review-misses cursor: ids served this review pass (cycles when exhausted). */
  reviewServed: Set<string>;
  /** Drill anti-repeat cursor: ids served this drill (cycles when exhausted). */
  drillServed: Set<string>;
}

/** A fresh selection state; `pendingNumber` opens a shared `?puzzle=N` first. */
export function initialSelectionState(pendingNumber: number | null = null): SelectionState {
  return {
    pendingNumber,
    recent: [],
    recentLoaded: false,
    recentTags: [],
    reviewServed: new Set(),
    drillServed: new Set(),
  };
}

/**
 * Select the next puzzle, advancing `state`'s cursors in place, or `null` when the
 * active mode has nothing to serve (empty bank / no misses / no tag matches). Pure
 * but for the injected `db` and `config.random`.
 */
export async function selectNextPuzzle(
  db: SelectorDb,
  config: SelectionConfig,
  state: SelectionState,
): Promise<Puzzle | null> {
  const random = config.random ?? Math.random;
  const drill = (config.drillTags?.length ?? 0) > 0;

  // 1. One-shot shared puzzle (#49): open it first, then fall back to the loop.
  const wanted = state.pendingNumber;
  state.pendingNumber = null;
  let next = wanted != null ? await db.getPuzzleByNumber(wanted) : null;

  // 2. Drill (#85): random over the selected tags, no band/window. Walk without
  // repeats this session; once exhausted, cycle. Does NOT touch the windows below.
  if (!next && drill) {
    const tags = config.drillTags ?? [];
    let pool = await db.fetchPuzzlesByTags(tags, { excludeIds: [...state.drillServed] });
    if (pool.length === 0 && state.drillServed.size > 0) {
      state.drillServed.clear();
      pool = await db.fetchPuzzlesByTags(tags);
    }
    next = pool[0] ?? null;
    if (next) state.drillServed.add(next.id);
    return next;
  }

  if (!next) {
    // Hydrate the anti-repeat window once, before the first matchmade/review serve,
    // so the very first puzzle already excludes the last 200 attempted.
    if (!state.recentLoaded) {
      try {
        state.recent = await db.getRecentAttemptedPuzzleIds(config.userId, RECENT_PUZZLE_WINDOW);
      } catch {
        // Best-effort: a window-load hiccup just weakens anti-repeat this session.
      }
      state.recentLoaded = true;
    }

    if (config.reviewMode) {
      // 3. Review-misses (#75): misses oldest-first, bypassing window AND band.
      const misses = await db.getMissPuzzleIds(config.userId);
      let missId = misses.find((id) => !state.reviewServed.has(id));
      if (!missId && misses.length > 0) {
        state.reviewServed.clear();
        missId = misses[0];
      }
      if (missId) {
        state.reviewServed.add(missId);
        next = await db.getPuzzle(missId);
      }
    } else {
      // 4. ~1-in-10 due-miss injection (#75): resurface the oldest DUE miss (one
      // fallen out of the window), band ignored; the rest stay fresh.
      try {
        const misses = await db.getMissPuzzleIds(config.userId);
        const due = dueMisses(misses, state.recent);
        if (shouldInjectMiss(random(), due.length)) {
          next = await db.getPuzzle(due[0]);
        }
      } catch {
        // A miss-derivation hiccup just skips injection; fresh play continues.
      }
      // 5. Matchmaking (#44/#99): a puzzle in the rating band, excluding the
      // anti-repeat window, de-clustered away from the recent headline types.
      if (!next) {
        const rating = (await db.getUserRating(config.userId))?.rating ?? SEED_RATING;
        next = await db.getMatchmadePuzzle({
          rating,
          recentIds: state.recent,
          recentTags: state.recentTags,
        });
      }
    }
  }

  // Record the serve in the windows (every mode except drill, which returned above):
  // prepend the id (newest-first, deduped, capped) and its headline type, so the
  // next serve excludes it and steers away from its type.
  if (next) {
    const served = next.id;
    state.recent = [served, ...state.recent.filter((id) => id !== served)].slice(
      0,
      RECENT_PUZZLE_WINDOW,
    );
    state.recentTags = [dominantTag(next.tags), ...state.recentTags].slice(0, ANTISTREAK_WINDOW);
  }
  return next;
}
