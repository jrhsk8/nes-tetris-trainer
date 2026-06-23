/**
 * Puzzle loader (#11) — selects a puzzle from the bank (random selection via
 * #2) and hands it to {@link PuzzleSession}, then loads another on "Next".
 * Handles the loading, empty-bank, and error states.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RECENT_PUZZLE_WINDOW, SEED_RATING, type DataAccess, type Puzzle } from '@trainer/data';
import { PuzzleSession } from './PuzzleSession.js';
import { PlayScreen } from './PlayScreen.js';
import { type KeyBindings } from '../board/keybindings.js';

/** The persistence the loader + session need. */
export type PlayDb = Pick<
  DataAccess,
  | 'getMatchmadePuzzle'
  | 'getPuzzleByNumber'
  | 'getRecentAttemptedPuzzleIds'
  | 'getUserRating'
  | 'upsertUserRating'
  | 'insertAttempt'
  | 'isCurator'
  | 'flagPuzzle'
  | 'cullPuzzle'
  | 'setPuzzleActive'
>;

/**
 * The persistent anti-repeat window (#74): the 200 most-recently-attempted
 * distinct puzzles are excluded from selection so a puzzle returns later, not
 * soon — and, being derived from `attempts`, the exclusion survives reloads
 * (docs/decisions.md 2026-06-23). Replaces the session-only 10-id ring.
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
}

export function PuzzlePlay({
  db,
  userId,
  initialPuzzleNumber = null,
  onAdvance,
  leftFlank,
  bindings,
  muted,
}: PuzzlePlayProps) {
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

  const load = useCallback(async () => {
    setPuzzle(undefined);
    setError(null);
    onAdvanceRef.current?.();
    try {
      const wanted = pendingNumberRef.current;
      pendingNumberRef.current = null; // one-shot — the loop is matchmade hereafter
      let next = wanted != null ? await db.getPuzzleByNumber(wanted) : null;
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
        const rating = (await db.getUserRating(userId))?.rating ?? SEED_RATING;
        next = await db.getMatchmadePuzzle({ rating, recentIds: recentRef.current });
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
  }, [db, userId]);

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
    />
  );
}
