/**
 * Puzzle loader (#11) — selects a puzzle from the bank (random selection via
 * #2) and hands it to {@link PuzzleSession}, then loads another on "Next".
 * Handles the loading, empty-bank, and error states.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SEED_RATING, type DataAccess, type Puzzle } from '@trainer/data';
import { PuzzleSession } from './PuzzleSession.js';
import { PlayScreen } from './PlayScreen.js';
import { type KeyBindings } from '../board/keybindings.js';

/** The persistence the loader + session need. */
export type PlayDb = Pick<
  DataAccess,
  'getMatchmadePuzzle' | 'getPuzzleByNumber' | 'getUserRating' | 'upsertUserRating' | 'insertAttempt'
>;

/**
 * How many just-played puzzles to keep on the anti-repeat cooldown (#44). A
 * puzzle in this window is excluded from selection so it returns later, not
 * soon (docs/glossary.md "Anti-repeat cooldown").
 */
const COOLDOWN_WINDOW = 10;

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

  // The recently-seen cooldown window (#44), kept in a ref so selecting the
  // next puzzle never re-creates `load` and re-triggers the mount effect (#17).
  const recentRef = useRef<string[]>([]);

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
        const rating = (await db.getUserRating(userId))?.rating ?? SEED_RATING;
        next = await db.getMatchmadePuzzle({ rating, recentIds: recentRef.current });
      }
      if (next) {
        recentRef.current = [...recentRef.current, next.id].slice(-COOLDOWN_WINDOW);
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
