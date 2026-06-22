/**
 * Puzzle session flow (#11, #35) — the headline play loop (docs/PRD-v1.md
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
  gradeCombo,
  comboOutcomeKey,
  PIECE_GROUP,
  ROWS,
  COLS,
  type ColorGrid,
  type Line,
  type Placement,
} from '@trainer/core';
import type { DataAccess, Glicko, Puzzle } from '@trainer/data';
import { applyAttempt, seedRating, updateRatings, attemptOutcome } from '@trainer/rating';
import { PlacementInput } from '../board/PlacementInput.js';
import { NextPieceBox } from '../board/NextPieceBox.js';
import { DEFAULT_BINDINGS, type KeyBindings } from '../board/keybindings.js';
import { Feedback } from '../feedback/index.js';
import { PlayScreen } from './PlayScreen.js';
import { PuzzleTitle } from './PuzzleTitle.js';

/** The persistence the session needs (rating read/write + attempt insert). */
export type SessionDb = Pick<DataAccess, 'getUserRating' | 'upsertUserRating' | 'insertAttempt'>;

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
}

interface RatingChange {
  before: Glicko;
  after: Glicko;
  delta: number;
}

interface SessionResult {
  solved: boolean;
  rating: RatingChange;
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

  const finish = useCallback(
    async (userLine: Placement[], solved: boolean, score: number | null) => {
      setPhase('grading');
      // Graded reward (#51): the rating moves by answer quality, not pass/fail.
      // An unranked combo (score null) falls back to the binary solved signal.
      const outcome = attemptOutcome(score, solved);
      let rating: RatingChange;
      try {
        const applied = await applyAttempt(db, userId, puzzle.glicko, outcome);
        await db.insertAttempt({
          userId,
          puzzleId: puzzle.id,
          userLine,
          solved,
          score,
          ratingAfter: applied.after.rating,
        });
        rating = { before: applied.before, after: applied.after, delta: applied.delta };
      } catch (err) {
        // A real persistence failure (e.g. anonymous sign-ins disabled so RLS
        // drops the write, #39) used to be silently swallowed here, hiding the
        // "rating never changes" bug. Surface it for diagnosis, then still show
        // the computed rating change so the loop stays playable.
        console.error('attempt/rating persistence failed:', err);
        const update = updateRatings(seedRating(), puzzle.glicko, outcome);
        rating = {
          before: seedRating(),
          after: update.user,
          delta: update.user.rating - seedRating().rating,
        };
      }
      setResult({ solved, rating, userLine });
      setPhase('done');
    },
    [db, userId, puzzle.glicko, puzzle.id],
  );

  const onConfirm1 = useCallback((p1: Placement) => {
    // Always advance to placement 2 — both pieces are played even if the first
    // is weak; the combo is graded as a whole (#35).
    setPlacement1(p1);
    setPhase('place2');
  }, []);

  const onConfirm2 = useCallback(
    (p2: Placement) => {
      const line: Line = [placement1!, p2];
      // Grade by the attempt's resulting-board key (#42): the combo is matched
      // by where the pieces rest, not by the (rotation, col) tuple.
      const graded = gradeCombo(
        puzzle.combos,
        line,
        comboOutcomeKey(board0, puzzle.piece1, puzzle.piece2, line),
      );
      void finish([placement1!, p2], graded.correct, graded.score);
    },
    [placement1, puzzle.combos, board0, puzzle.piece1, puzzle.piece2, finish],
  );

  if (phase === 'place1') {
    return (
      <PlayScreen leftFlank={leftFlank}>
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
      <PlayScreen leftFlank={leftFlank}>
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
      <PlayScreen leftFlank={leftFlank}>
        <div className="play-center" data-testid="board-center">
          <PuzzleTitle number={puzzle.number} />
          <p role="status">Grading…</p>
        </div>
      </PlayScreen>
    );
  }

  // phase === 'done'
  return (
    <PlayScreen leftFlank={leftFlank}>
      <Feedback
        number={puzzle.number}
        board0={board0}
        piece1={puzzle.piece1}
        piece2={puzzle.piece2}
        baseColors={colors0}
        combos={puzzle.combos}
        userLine={result!.userLine}
        ratingChange={result!.rating}
        onNext={onNext}
        muted={muted}
      />
    </PlayScreen>
  );
}
