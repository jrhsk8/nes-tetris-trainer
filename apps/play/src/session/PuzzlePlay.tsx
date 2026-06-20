/**
 * Puzzle loader (#11) — selects a puzzle from the bank (random selection via
 * #2) and hands it to {@link PuzzleSession}, then loads another on "Next".
 * Handles the loading, empty-bank, and error states.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DataAccess, Puzzle } from '@trainer/data';
import { PuzzleSession } from './PuzzleSession.js';

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
}

export function PuzzlePlay({ db, userId, onAdvance }: PuzzlePlayProps) {
  // undefined = loading, null = empty bank, Puzzle = ready.
  const [puzzle, setPuzzle] = useState<Puzzle | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPuzzle(undefined);
    setError(null);
    onAdvance?.();
    try {
      setPuzzle(await db.getRandomPuzzle());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load a puzzle');
    }
  }, [db, onAdvance]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p role="alert">Could not load a puzzle: {error}</p>;
  if (puzzle === undefined) return <p>Loading puzzle…</p>;
  if (puzzle === null) return <p>No puzzles in the bank yet.</p>;

  return (
    <PuzzleSession
      key={puzzle.id}
      puzzle={puzzle}
      userId={userId}
      db={db}
      onNext={() => void load()}
    />
  );
}
