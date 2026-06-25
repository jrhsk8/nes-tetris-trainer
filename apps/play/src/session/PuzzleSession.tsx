/**
 * Puzzle session flow (#11, #35) — the headline play loop (.claude/docs/PRD-v1.md
 * "Solution", user stories 1-10). Presents the board with the current and next
 * piece, captures placement 1, then presents the second piece with NO lookahead
 * and captures placement 2, grades the whole two-piece combo (#34), updates the
 * rating (#6), and records the attempt (#2).
 *
 * The player ALWAYS places both pieces — even a wrong first placement advances
 * to placement 2 (#35); the attempt is the combo `(p1, p2)`, graded against the
 * puzzle's stored combo table (correct iff the combo scores ≥ 95). There is no
 * first-move short-circuit.
 *
 * Laid out as a flanking dashboard (#22): the board is the centred hero and
 * never moves between phases; the left rail holds the rating, the right rail
 * holds the next-piece box while solving and the verdict + ranked combo list
 * after an attempt (see {@link PlayScreen} and {@link Feedback}).
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  applyPlacement,
  applyPlacementColored,
  decodeBoard,
  decodeColors,
  PIECE_GROUP,
  ROWS,
  COLS,
  type ColorGrid,
  type Placement,
} from '@trainer/core';
import type { DataAccess, Puzzle } from '@trainer/data';
import { recordAttempt, type AttemptResult, type RecordAttemptDb } from './record-attempt.js';
import { PlacementInput } from '../board/PlacementInput.js';
import { NextPieceBox } from '../board/NextPieceBox.js';
import { DEFAULT_BINDINGS, type KeyBindings } from '../board/keybindings.js';
import { Feedback, StarRating } from '../feedback/index.js';
import { Curation, CurationAnalytics } from '../curation/index.js';
import { PlayScreen } from './PlayScreen.js';
import { PuzzleTitle } from './PuzzleTitle.js';

/** The persistence the session needs (attempt recording + stars + curation). */
export type SessionDb = RecordAttemptDb &
  Pick<
    DataAccess,
    | 'upsertStarRating'
    | 'getMyStarRating'
    | 'getStarStats'
    | 'isAdmin'
    | 'flagPuzzle'
    | 'cullPuzzle'
    | 'setPuzzleActive'
    | 'getCurationTagStats'
  >;

export interface PuzzleSessionProps {
  puzzle: Puzzle;
  /** The player's id (a stub before auth, #13). */
  userId: string;
  db: SessionDb;
  /** Called when the player asks for the next puzzle. */
  onNext?: () => void;
  /** Content for the left rail (the rating panel). */
  leftFlank?: ReactNode;
  /** Player key bindings (defaults to {@link DEFAULT_BINDINGS}). */
  bindings?: KeyBindings;
  /** Mute the NES result chiptune (#61); defaults to off (sound plays). */
  muted?: boolean;
  /**
   * Drill mode (#85): unrated practice. When true the attempt is graded and
   * feedback shown as usual, but the player/puzzle rating is NOT updated and NO
   * `attempts` row is written (so per-type stats stay rated-mainline-only).
   */
  drill?: boolean;
}

interface SessionResult extends AttemptResult {
  userLine: readonly Placement[];
}

type Phase = 'place1' | 'place2' | 'grading' | 'done';

export function PuzzleSession({
  puzzle,
  userId,
  db,
  onNext,
  leftFlank,
  bindings = DEFAULT_BINDINGS,
  muted = false,
  drill = false,
}: PuzzleSessionProps) {
  const board0 = useMemo(() => decodeBoard(puzzle.board), [puzzle.board]);
  // The puzzle's stored colour grid (#28), decoded once. Legacy puzzles carry
  // an empty string; those render with the white-group fallback.
  const colors0 = useMemo<ColorGrid | undefined>(
    () => (puzzle.colors && puzzle.colors.length === ROWS * COLS ? decodeColors(puzzle.colors) : undefined),
    [puzzle.colors],
  );
  const [phase, setPhase] = useState<Phase>('place1');
  const [placement1, setPlacement1] = useState<Placement | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);

  const board1 = useMemo(
    () => (placement1 ? applyPlacement(board0, puzzle.piece1, placement1) : null),
    [board0, puzzle.piece1, placement1],
  );
  // Colours after the player's first move, so the stack stays authentic into
  // placement 2 (the placed piece takes its own colour group).
  const colors1 = useMemo<ColorGrid | undefined>(
    () =>
      colors0 && placement1
        ? applyPlacementColored(board0, colors0, puzzle.piece1, placement1, PIECE_GROUP[puzzle.piece1])
            .colors
        : undefined,
    [colors0, board0, puzzle.piece1, placement1],
  );

  const finishAttempt = useCallback(
    async (userLine: Placement[]) => {
      setPhase('grading');
      const result = await recordAttempt(db, userId, puzzle, board0, userLine, drill);
      setResult({ ...result, userLine });
      setPhase('done');
    },
    [db, userId, puzzle, board0, drill],
  );

  // The left rail carries the rating plus the dev curation controls (#72). The
  // curation block renders nothing for non-curators (everyone, until a curator is
  // allowlisted), so it has no layout effect in normal play.
  const flank = (
    <>
      {leftFlank}
      <Curation db={db} userId={userId} puzzleId={puzzle.id} />
      {/* Bank-wide per-type analytics (#87): admin-only reveal, same as Curation. */}
      <CurationAnalytics db={db} />
    </>
  );

  const onConfirm1 = useCallback((p1: Placement) => {
    // Always advance to placement 2 — both pieces are played even if the first
    // is weak; the combo is graded as a whole (#35).
    setPlacement1(p1);
    setPhase('place2');
  }, []);

  const onConfirm2 = useCallback(
    (p2: Placement) => {
      void finishAttempt([placement1!, p2]);
    },
    [placement1, finishAttempt],
  );

  if (phase === 'place1') {
    return (
      <PlayScreen leftFlank={flank}>
        <div className="play-center" data-testid="board-center">
          <PuzzleTitle number={puzzle.number} />
          <p className="play-instruction">
            Place the <strong>{puzzle.piece1}</strong>.
          </p>
          <PlacementInput
            board={board0}
            colorGrid={colors0}
            piece={puzzle.piece1}
            onConfirm={onConfirm1}
            bindings={bindings}
          />
        </div>
        <aside className="flank flank-right" aria-label="next piece">
          <NextPieceBox piece={puzzle.piece2} />
        </aside>
      </PlayScreen>
    );
  }

  if (phase === 'place2' && board1) {
    return (
      <PlayScreen leftFlank={flank}>
        <div className="play-center" data-testid="board-center">
          <PuzzleTitle number={puzzle.number} />
          <p className="play-instruction">
            Place the <strong>{puzzle.piece2}</strong>. <em>(no next piece)</em>
          </p>
          <PlacementInput
            board={board1}
            colorGrid={colors1}
            piece={puzzle.piece2}
            onConfirm={onConfirm2}
            bindings={bindings}
          />
        </div>
        <aside className="flank flank-right" aria-label="next piece">
          <NextPieceBox piece={null} />
        </aside>
      </PlayScreen>
    );
  }

  if (phase === 'grading') {
    return (
      <PlayScreen leftFlank={flank}>
        <div className="play-center" data-testid="board-center">
          <PuzzleTitle number={puzzle.number} />
          <p role="status">Grading…</p>
        </div>
      </PlayScreen>
    );
  }

  // phase === 'done'
  return (
    <PlayScreen leftFlank={flank}>
      <Feedback
        number={puzzle.number}
        tags={puzzle.tags}
        board0={board0}
        piece1={puzzle.piece1}
        piece2={puzzle.piece2}
        baseColors={colors0}
        combos={puzzle.combos}
        userLine={result!.userLine}
        ratingChange={result!.rating ?? undefined}
        drill={drill}
        puzzleRating={puzzle.glicko.rating}
        solveStats={result!.solveStats}
        starControl={<StarRating db={db} userId={userId} puzzleId={puzzle.id} />}
        onNext={onNext}
        muted={muted}
        bindings={bindings}
      />
    </PlayScreen>
  );
}
