/**
 * Feedback view (#12, #22, #25, #35) — the teaching payoff (docs/PRD-v1.md
 * "Feedback").
 *
 * After an attempt it shows an unmistakable Correct / Incorrect verdict banner
 * with the combo's 0–100 score (#35), then a ranked list of the puzzle's top-5
 * two-piece combos. The player's combo is highlighted in-list when it ranks in
 * the top-5, otherwise a row below shows its exact rank + score or "too low to
 * rank". Selecting any row replays that combo on the central board as a colour-
 * aware falling animation (#25/#31): each piece spawns, slides into its column
 * and drops to rest, locking into the stack with its NES colours; a line clear
 * flashes and collapses. The player's own move is selected by default. With
 * `prefers-reduced-motion` the board snaps straight to the settled combo.
 *
 * Grading is client-side via @trainer/core's combo-threshold checker (#34)
 * against the puzzle's stored combo table — no engine call is made.
 *
 * Laid out for the flanking dashboard (#22): `display: contents` drops its two
 * regions — the animating board and the result panel (verdict + rating + ranked
 * list + Next) — into the play screen's centre and right columns, so the board
 * stays in the same centre position it occupied while solving.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  gradeCombo,
  comboOutcomeKey,
  type ColorGrid,
  type ComboTable,
  type Grid,
  type Line,
  type Piece,
  type Placement,
} from '@trainer/core';
import { Board } from '../board/Board.js';
import { PIECE_GROUP, blockBackground } from '../board/nes.js';
import { ComboList } from './ComboList.js';
import { formatScore } from './grade.js';
import { buildReplay, type Keyframe, type ReplayOverlay } from './replay.js';
import { PuzzleTitle } from '../session/PuzzleTitle.js';

/** A player rating change to surface alongside the verdict. */
export interface RatingChange {
  before: { rating: number };
  after: { rating: number };
  delta: number;
}

export interface FeedbackProps {
  /** The puzzle's stable number (#49) — shown as the title; null for legacy. */
  number?: number | null;
  /** The starting board. */
  board0: Grid;
  piece1: Piece;
  piece2: Piece;
  /** The starting board's colour grid (#31); enables the colour-aware replay. */
  baseColors?: ColorGrid;
  /** The puzzle's stored ranked combo table (#33). */
  combos: ComboTable;
  /** The placements the player actually made (one or two). */
  userLine: readonly Placement[];
  /** Milliseconds per animation step (also the falling-piece transition time). */
  stepMs?: number;
  /** The rating change to display, if any. */
  ratingChange?: RatingChange;
  /** Called when the player asks for the next puzzle (renders the button). */
  onNext?: () => void;
}

/** True if the user has asked for reduced motion (read once, at mount). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The falling piece, drawn on a board-sized overlay that the transform moves. */
function FallingPiece({ overlay, durationMs }: { overlay: ReplayOverlay; durationMs: number }) {
  const background = blockBackground(PIECE_GROUP[overlay.piece]);
  return (
    <div
      data-testid="falling-piece"
      className="falling-piece"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(10, 1fr)',
        gridTemplateRows: 'repeat(20, 1fr)',
        transform: overlay.transform,
        transition: `transform ${durationMs}ms cubic-bezier(0.35, 0.1, 0.3, 1)`,
        willChange: 'transform',
        pointerEvents: 'none',
      }}
    >
      {overlay.cells.map(([r, c]) => (
        <div
          key={`${r}-${c}`}
          data-testid="falling-cell"
          style={{
            gridRow: r + 1,
            gridColumn: c + 1,
            backgroundImage: background,
            backgroundSize: '100% 100%',
          }}
        />
      ))}
    </div>
  );
}

/** The flash drawn over rows about to be cleared. */
function LineFlash({ rows }: { rows: readonly number[] }) {
  return (
    <div
      data-testid="line-flash"
      className="line-flash"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(10, 1fr)',
        gridTemplateRows: 'repeat(20, 1fr)',
        pointerEvents: 'none',
      }}
    >
      {rows.flatMap((r) =>
        Array.from({ length: 10 }, (_, c) => (
          <div
            key={`${r}-${c}`}
            className="line-flash-cell"
            style={{ gridRow: r + 1, gridColumn: c + 1 }}
          />
        )),
      )}
    </div>
  );
}

/** The (rotation, col) pair the player played, as a Line, or null if incomplete. */
function playerLineOf(userLine: readonly Placement[]): Line | null {
  return userLine.length >= 2 ? [userLine[0], userLine[1]] : null;
}

/** The rank-1 combo as a Line, or null if the table is empty. */
function bestLineOf(combos: ComboTable): Line | null {
  const e = combos.entries[0];
  return e ? [{ rotation: e.rot1, col: e.col1 }, { rotation: e.rot2, col: e.col2 }] : null;
}

export function Feedback({
  number = null,
  board0,
  piece1,
  piece2,
  baseColors,
  combos,
  userLine,
  stepMs = 320,
  ratingChange,
  onNext,
}: FeedbackProps) {
  const [reduced] = useState(prefersReducedMotion);

  const playerLine = useMemo(() => playerLineOf(userLine), [userLine]);
  // Grade the whole combo — no first-move short-circuit (#34).
  const verdict = useMemo(
    () =>
      playerLine
        ? gradeCombo(combos, playerLine, comboOutcomeKey(board0, piece1, piece2, playerLine))
        : { correct: false, score: null, rank: null, total: combos.total, ranked: false },
    [combos, playerLine, board0, piece1, piece2],
  );

  // The combo currently shown on the board; the player's move by default, or the
  // rank-1 combo if the player did not complete the attempt.
  const [selected, setSelected] = useState<Line>(() => playerLine ?? bestLineOf(combos) ?? [
    { rotation: 0, col: 0 },
    { rotation: 0, col: 0 },
  ]);

  const timeline = useMemo<Keyframe[]>(() => {
    const keyframes = buildReplay(board0, piece1, piece2, selected, baseColors);
    // Reduced motion: jump straight to the settled board (last keyframe).
    return reduced ? [keyframes[keyframes.length - 1]] : keyframes;
  }, [board0, piece1, piece2, selected, baseColors, reduced]);

  const [step, setStep] = useState(0);

  // Restart the replay whenever the timeline changes (new attempt / selection).
  useEffect(() => setStep(0), [timeline]);

  useEffect(() => {
    if (step >= timeline.length - 1) return;
    const timer = setTimeout(() => setStep((s) => s + 1), stepMs);
    return () => clearTimeout(timer);
  }, [step, timeline.length, stepMs]);

  const frame = timeline[Math.min(step, timeline.length - 1)];
  // Letter grade + one-decimal score (#60), e.g. `A+ 97.6`; unranked combos have
  // no numeric score and read as "too low to rank".
  const scoreText = verdict.score !== null ? formatScore(verdict.score) : 'Too low to rank';

  return (
    <div className="feedback">
      <div className="play-center feedback-board" data-testid="board-center">
        <PuzzleTitle number={number} />
        <Board
          grid={frame.grid}
          colorGrid={frame.colorGrid}
          overlay={
            <>
              {frame.overlay ? (
                <FallingPiece
                  key={`falling-${frame.overlayKey}`}
                  overlay={frame.overlay}
                  durationMs={stepMs}
                />
              ) : null}
              {frame.flashRows ? <LineFlash rows={frame.flashRows} /> : null}
            </>
          }
        />
        <p data-testid="feedback-step">
          {frame.label} · {Math.min(step + 1, timeline.length)}/{timeline.length}
        </p>
        <button type="button" onClick={() => setStep(0)}>
          Replay
        </button>
      </div>

      <aside className="flank flank-right result-panel" aria-label="result">
        <div
          className={`verdict ${verdict.correct ? 'is-correct' : 'is-incorrect'}`}
          data-testid="verdict"
          data-correct={verdict.correct}
        >
          <strong className="verdict-outcome">{verdict.correct ? 'Correct' : 'Incorrect'}</strong>
          <span className="verdict-score" data-testid="verdict-score">
            {scoreText}
          </span>
        </div>

        {ratingChange ? (
          <p data-testid="rating-change">
            Rating: {Math.round(ratingChange.before.rating)} →{' '}
            {Math.round(ratingChange.after.rating)} ({ratingChange.delta >= 0 ? '+' : ''}
            {Math.round(ratingChange.delta)})
          </p>
        ) : null}

        <ComboList
          entries={combos.entries}
          total={combos.total}
          userLine={userLine}
          playerRank={verdict.rank}
          playerScore={verdict.score}
          selected={selected}
          onSelect={setSelected}
        />

        {onNext ? (
          <button type="button" onClick={onNext}>
            Next puzzle
          </button>
        ) : null}
      </aside>
    </div>
  );
}
