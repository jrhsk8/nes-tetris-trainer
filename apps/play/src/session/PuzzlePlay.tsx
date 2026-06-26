/**
 * Puzzle loader (#11) — selects a puzzle from the bank (random selection via
 * #2) and hands it to {@link PuzzleSession}, then loads another on "Next".
 * Handles the loading, empty-bank, and error states.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { type DataAccess, type Puzzle } from '@trainer/data';
import { type PuzzleTag } from '@trainer/core';
import { PuzzleSession } from './PuzzleSession.js';
import { PlayScreen } from './PlayScreen.js';
import {
  selectNextPuzzle,
  initialSelectionState,
  type SelectionState,
} from './puzzle-selector.js';
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
  | 'updatePuzzleRating'
  | 'insertAttempt'
  | 'getPuzzleSolveStats'
  | 'upsertStarRating'
  | 'getMyStarRating'
  | 'getStarStats'
  | 'isAdmin'
  | 'flagPuzzle'
  | 'cullPuzzle'
  | 'setPuzzleActive'
  | 'getCurationTagStats'
>;

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
  // re-select a puzzle — the rapid flashing loop in #17.
  const onAdvanceRef = useRef(onAdvance);
  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  // The selection cursors (#74/#75/#85/#99) — the anti-repeat window, the
  // anti-streak window, the drill/review served-sets, and the pending shared
  // number — carried across serves in one ref so selecting the next puzzle never
  // re-creates `load` and re-triggers the mount effect (#17). The selection logic
  // itself is {@link selectNextPuzzle}, pure and tested on its own.
  const selectionRef = useRef<SelectionState>(initialSelectionState(initialPuzzleNumber));

  // `drillTags` / `random` change identity per render; read them via refs so
  // `load`'s identity does not (the stable `drillKey` below re-triggers a reload
  // when the tag set actually changes).
  const drillTagsRef = useRef(drillTags);
  useEffect(() => {
    drillTagsRef.current = drillTags;
  }, [drillTags]);
  const randomRef = useRef(random);
  useEffect(() => {
    randomRef.current = random;
  }, [random]);
  const drillKey = drill ? [...(drillTags ?? [])].slice().sort().join(',') : '';

  const load = useCallback(async () => {
    setPuzzle(undefined);
    setError(null);
    onAdvanceRef.current?.();
    try {
      const next = await selectNextPuzzle(
        db,
        { userId, reviewMode, drillTags: drillTagsRef.current, random: randomRef.current },
        selectionRef.current,
      );
      setPuzzle(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load a puzzle');
    }
    // `drill` / `drillKey` are deps (not read in the body): they re-create `load`
    // so the mount effect re-selects when drill mode toggles or the tag set changes.
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
