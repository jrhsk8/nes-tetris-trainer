/**
 * Puzzle loader (#11) — selects a puzzle from the bank (random selection via
 * #2) and hands it to {@link PuzzleSession}, then loads another on "Next".
 * Handles the loading, empty-bank, and error states.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataAccess, Puzzle } from '@trainer/data';
import { PuzzleSession } from './PuzzleSession.js';
import { PlayScreen } from './PlayScreen.js';

/** The persistence the loader + session need. */
export type PlayDb = Pick<
  DataAccess,
  'getRandomPuzzle' | 'getUserRating' | 'upsertUserRating' | 'insertAttempt'
>;

export interface PuzzlePlayProps {
  db: PlayDb;
  userId: string;
  /** Called when a new puzzle is loaded (e.g. to refresh the rating history). */
  onAdvance?: () => void;
  /** Content for the play screen's left rail (the rating panel). */
  leftFlank?: ReactNode;
}

export function PuzzlePlay({ db, userId, onAdvance, leftFlank }: PuzzlePlayProps) {
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

  const load = useCallback(async () => {
    setPuzzle(undefined);
    setError(null);
    onAdvanceRef.current?.();
    try {
      setPuzzle(await db.getRandomPuzzle());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load a puzzle');
    }
  }, [db]);

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
    />
  );
}
