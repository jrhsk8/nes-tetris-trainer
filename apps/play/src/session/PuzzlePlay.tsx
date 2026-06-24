/**
 * Puzzle loader (#11) — selects a puzzle from the bank (random selection via
 * #2) and hands it to {@link PuzzleSession}, then loads another on "Next".
 * Handles the loading, empty-bank, and error states.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  RECENT_PUZZLE_WINDOW,
  SEED_RATING,
  dueMisses,
  shouldInjectMiss,
  type DataAccess,
  type Puzzle,
} from '@trainer/data';
import type { PuzzleTag } from '@trainer/core';
import { PuzzleSession } from './PuzzleSession.js';
import { PlayScreen } from './PlayScreen.js';
import { type KeyBindings } from '../board/keybindings.js';

/** The persistence the loader + session need. */
export type PlayDb = Pick<
  DataAccess,
  | 'getMatchmadePuzzle'
  | 'fetchPuzzlesByTags'
  | 'getPuzzle'
  | 'getPuzzleByNumber'
  | 'getRecentAttemptedPuzzleIds'
  | 'getMissPuzzleIds'
  | 'getUserRating'
  | 'upsertUserRating'
  | 'insertAttempt'
  | 'getPuzzleSolveStats'
  | 'upsertStarRating'
  | 'getMyStarRating'
  | 'getStarStats'
  | 'isCurator'
  | 'flagPuzzle'
  | 'cullPuzzle'
  | 'setPuzzleActive'
>;

/**
 * The persistent anti-repeat window (#74): the 200 most-recently-attempted
 * distinct puzzles are excluded from selection so a puzzle returns later, not
 * soon — and, being derived from `attempts`, the exclusion survives reloads
 * (.claude/docs/decisions.md 2026-06-23). Replaces the session-only 10-id ring.
 */
const RECENT_WINDOW = RECENT_PUZZLE_WINDOW;

export interface PuzzlePlayProps {
  db: PlayDb;
  userId: string;
  /**
   * A shared puzzle number (#49) to open instead of matchmaking on first load —
   * from a `?puzzle=N` link. Loaded by number once; "Next" then returns to the
   * normal matchmade loop. A missing/invalid number just falls back to
   * matchmaking immediately.
   */
  initialPuzzleNumber?: number | null;
  /** Called when a new puzzle is loaded (e.g. to refresh the rating history). */
  onAdvance?: () => void;
  /** Content for the play screen's left rail (the rating panel). */
  leftFlank?: ReactNode;
  /** Player key bindings, threaded to the placement input. */
  bindings?: KeyBindings;
  /** Mute the NES result chiptune (#61); threaded to the session feedback. */
  muted?: boolean;
  /**
   * Review-misses mode (#75): serve the player's misses (attempted-but-unsolved)
   * **oldest-first**, bypassing the anti-repeat window AND the rating band.
   * Solving one removes it from the set; default `false` = normal matchmade play
   * (which still ~1-in-10 auto-injects a due miss).
   */
  reviewMode?: boolean;
  /**
   * Drill mode (#85): unrated practice filtered to these type-tags. When set and
   * non-empty, serve random puzzles carrying ANY of the tags (OR), bypassing
   * matchmaking; attempts are graded but neither rated nor written. Empty/unset
   * = normal rated matchmaking.
   */
  drillTags?: readonly PuzzleTag[];
  /** Injectable RNG in `[0, 1)` for the miss auto-injection (#75); tests override. */
  random?: () => number;
}

export function PuzzlePlay({
  db,
  userId,
  initialPuzzleNumber = null,
  onAdvance,
  leftFlank,
  bindings,
  muted,
  reviewMode = false,
  drillTags,
  random = Math.random,
}: PuzzlePlayProps) {
  const drill = (drillTags?.length ?? 0) > 0;
  // undefined = loading, null = empty bank, Puzzle = ready.
  const [puzzle, setPuzzle] = useState<Puzzle | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // Hold the latest `onAdvance` in a ref so `load` does NOT depend on its
  // identity. Callers (e.g. Account) pass a fresh inline callback every render;
  // if `load` (and thus the mount effect) depended on it, each render would
  // re-select a puzzle — the rapid flashing loop in #17. With the ref, `load`
  // only changes when `db` does, so the loader runs exactly once on mount.
  const onAdvanceRef = useRef(onAdvance);
  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  // The persistent anti-repeat window (#74), kept in a ref so selecting the next
  // puzzle never re-creates `load` and re-triggers the mount effect (#17). It is
  // hydrated once per session from `attempts` (the 200 most-recently-attempted
  // distinct ids), then kept current in memory by prepending each served id.
  const recentRef = useRef<string[]>([]);
  const windowLoadedRef = useRef(false);

  // A shared puzzle to open first (#49), consumed once: after the shared puzzle
  // (or an invalid number that fell back), "Next" returns to matchmaking.
  const pendingNumberRef = useRef<number | null>(initialPuzzleNumber);

  // Review-misses cursor (#75): the miss ids already served THIS review session,
  // so "Next" walks the misses oldest-first without re-serving the same one; when
  // all have been served it cycles back to the oldest.
  const reviewServedRef = useRef<Set<string>>(new Set());

  // Drill-mode (#85) anti-repeat cursor + latest tag set (read via a ref so a
  // fresh `drillTags` array per render does not re-create `load`, #17). The
  // stable `drillKey` below is what actually re-triggers a reload on tag change.
  const drillServedRef = useRef<Set<string>>(new Set());
  const drillTagsRef = useRef(drillTags);
  useEffect(() => {
    drillTagsRef.current = drillTags;
  }, [drillTags]);
  const drillKey = drill ? [...(drillTags ?? [])].slice().sort().join(',') : '';

  // Latest RNG in a ref so `load`'s identity does not change per render (#17).
  const randomRef = useRef(random);
  useEffect(() => {
    randomRef.current = random;
  }, [random]);

  const load = useCallback(async () => {
    setPuzzle(undefined);
    setError(null);
    onAdvanceRef.current?.();
    try {
      const wanted = pendingNumberRef.current;
      pendingNumberRef.current = null; // one-shot — the loop is matchmade hereafter
      let next = wanted != null ? await db.getPuzzleByNumber(wanted) : null;
      if (!next && drill) {
        // Drill mode (#85): serve random puzzles carrying ANY selected tag (OR),
        // bypassing matchmaking + the rating band. Walk them without repeats this
        // session; once exhausted, cycle from the start.
        const tags = drillTagsRef.current ?? [];
        const served = drillServedRef.current;
        let pool = await db.fetchPuzzlesByTags(tags, { excludeIds: [...served] });
        if (pool.length === 0 && served.size > 0) {
          served.clear();
          pool = await db.fetchPuzzlesByTags(tags);
        }
        next = pool[0] ?? null;
        if (next) served.add(next.id);
        setPuzzle(next);
        return;
      }
      if (!next) {
        // Hydrate the persistent window once, before the first matchmade serve,
        // so the very first puzzle already excludes the last 200 attempted.
        if (!windowLoadedRef.current) {
          try {
            recentRef.current = await db.getRecentAttemptedPuzzleIds(userId, RECENT_WINDOW);
          } catch {
            // Best-effort: a window-load hiccup just weakens anti-repeat this
            // session; never block play on it.
          }
          windowLoadedRef.current = true;
        }

        if (reviewMode) {
          // Review-misses (#75): serve misses oldest-first, bypassing the window
          // AND the rating band. Walk them with a per-session cursor; cycle back
          // to the oldest once all have been served. Solved puzzles have already
          // dropped out of the freshly-derived miss set.
          const misses = await db.getMissPuzzleIds(userId);
          const served = reviewServedRef.current;
          let missId = misses.find((id) => !served.has(id));
          if (!missId && misses.length > 0) {
            served.clear();
            missId = misses[0];
          }
          if (missId) {
            served.add(missId);
            next = await db.getPuzzle(missId);
          }
        } else {
          // Normal play: ~1-in-10 serves resurface the oldest DUE miss (one that
          // has fallen out of the window), band ignored; the rest stay fresh.
          try {
            const misses = await db.getMissPuzzleIds(userId);
            const due = dueMisses(misses, recentRef.current);
            if (shouldInjectMiss(randomRef.current(), due.length)) {
              next = await db.getPuzzle(due[0]);
            }
          } catch {
            // A miss-derivation hiccup just skips injection; fresh play continues.
          }
          if (!next) {
            const rating = (await db.getUserRating(userId))?.rating ?? SEED_RATING;
            next = await db.getMatchmadePuzzle({ rating, recentIds: recentRef.current });
          }
        }
      }
      if (next) {
        // Prepend the served id (newest-first) and cap at the window size, so
        // it stays excluded for the rest of this session before `attempts`
        // records it for the next reload.
        const served = next.id;
        recentRef.current = [served, ...recentRef.current.filter((id) => id !== served)].slice(
          0,
          RECENT_WINDOW,
        );
      }
      setPuzzle(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load a puzzle');
    }
  }, [db, userId, reviewMode, drill, drillKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (puzzle === undefined || puzzle === null || error) {
    return (
      <PlayScreen leftFlank={leftFlank}>
        <div className="play-center" data-testid="board-center">
          {error ? (
            <p role="alert">Could not load a puzzle: {error}</p>
          ) : puzzle === undefined ? (
            <p>Loading puzzle…</p>
          ) : reviewMode ? (
            <p>No misses to review — solve more puzzles first.</p>
          ) : drill ? (
            <p>No puzzles match the selected types.</p>
          ) : (
            <p>No puzzles in the bank yet.</p>
          )}
        </div>
      </PlayScreen>
    );
  }

  return (
    <PuzzleSession
      key={puzzle.id}
      puzzle={puzzle}
      userId={userId}
      db={db}
      onNext={() => void load()}
      leftFlank={leftFlank}
      bindings={bindings}
      muted={muted}
      drill={drill}
    />
  );
}
