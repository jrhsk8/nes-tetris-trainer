/**
 * Feedback view (#12, #22) — the teaching payoff (docs/PRD-v1.md "Feedback").
 *
 * After an attempt it animates the stored optimal two-ply line on the board and
 * shows geometric metric deltas (holes, bumpiness, height) of the player's
 * result versus the optimal result. The optimal-side metrics are precomputed at
 * generation and passed in; the player-side metrics are computed here,
 * client-side, via @trainer/core (#3). No engine call is made.
 *
 * Laid out for the flanking dashboard (#22): the component uses `display:
 * contents` so its two regions — the animating board and the result panel
 * (outcome + rating change + chart + Next) — drop straight into the play
 * screen's centre and right columns. The board therefore stays in the same
 * centre position it occupied while solving.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  applyPlacement,
  boardMetrics,
  type BoardMetrics,
  type Grid,
  type Line,
  type Piece,
  type Placement,
} from '@trainer/core';
import { Board, type Cell } from '../board/Board.js';

/** A player rating change to surface alongside the outcome. */
export interface RatingChange {
  before: { rating: number };
  after: { rating: number };
  delta: number;
}

export interface FeedbackProps {
  /** The starting board. */
  board0: Grid;
  piece1: Piece;
  piece2: Piece;
  /** The stored optimal two-ply line. */
  optimalLine: Line;
  /** Precomputed metrics of the optimal result board. */
  optimalMetrics: BoardMetrics;
  /** The placements the player actually made (one or two). */
  userLine: readonly Placement[];
  /** Milliseconds between animation steps. */
  stepMs?: number;
  /** Whether the player solved the puzzle (shows the outcome heading). */
  solved?: boolean;
  /** The rating change to display, if any. */
  ratingChange?: RatingChange;
  /** Called when the player asks for the next puzzle (renders the button). */
  onNext?: () => void;
}

interface Frame {
  grid: Grid;
  highlight: Cell[];
  /** The piece that landed in this frame (drives the highlight colour). */
  piece: Piece | undefined;
}

/** Cells filled in `next` but not in `prev` (the piece that just landed). */
function newlyFilled(prev: Grid, next: Grid): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < next.length; r++) {
    for (let c = 0; c < next[r].length; c++) {
      if (next[r][c] && !prev[r][c]) cells.push([r, c]);
    }
  }
  return cells;
}

/** Board after applying the placements the player made (1 or 2). */
function applyUserLine(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  userLine: readonly Placement[],
): Grid {
  let board = applyPlacement(board0, piece1, userLine[0]);
  if (userLine.length > 1) board = applyPlacement(board, piece2, userLine[1]);
  return board;
}

const METRICS = [
  { key: 'holes', label: 'Holes' },
  { key: 'bumpiness', label: 'Bumpiness' },
  { key: 'aggregateHeight', label: 'Height' },
] as const;

export function Feedback({
  board0,
  piece1,
  piece2,
  optimalLine,
  optimalMetrics,
  userLine,
  stepMs = 900,
  solved,
  ratingChange,
  onNext,
}: FeedbackProps) {
  const frames = useMemo<Frame[]>(() => {
    const board1 = applyPlacement(board0, piece1, optimalLine[0]);
    const board2 = applyPlacement(board1, piece2, optimalLine[1]);
    return [
      { grid: board0, highlight: [], piece: undefined },
      { grid: board1, highlight: newlyFilled(board0, board1), piece: piece1 },
      { grid: board2, highlight: newlyFilled(board1, board2), piece: piece2 },
    ];
  }, [board0, piece1, piece2, optimalLine]);

  const userMetrics = useMemo(
    () => boardMetrics(applyUserLine(board0, piece1, piece2, userLine)),
    [board0, piece1, piece2, userLine],
  );

  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= frames.length - 1) return;
    const timer = setTimeout(() => setStep((s) => s + 1), stepMs);
    return () => clearTimeout(timer);
  }, [step, frames.length, stepMs]);

  return (
    <div className="feedback">
      <div className="play-center feedback-board" data-testid="board-center">
        <p className="play-instruction">The optimal line:</p>
        <Board
          grid={frames[step].grid}
          highlightCells={frames[step].highlight}
          highlightPiece={frames[step].piece}
        />
        <p data-testid="feedback-step">
          Step {step + 1} of {frames.length}
        </p>
        <button type="button" onClick={() => setStep(0)} disabled={step === 0}>
          Replay
        </button>
      </div>

      <aside className="flank flank-right result-panel" aria-label="result">
        {solved !== undefined ? (
          <h2 data-testid="outcome">{solved ? 'Solved!' : 'Not solved'}</h2>
        ) : null}
        {ratingChange ? (
          <p data-testid="rating-change">
            Rating: {Math.round(ratingChange.before.rating)} →{' '}
            {Math.round(ratingChange.after.rating)} ({ratingChange.delta >= 0 ? '+' : ''}
            {Math.round(ratingChange.delta)})
          </p>
        ) : null}

        <table className="metric-deltas">
          <thead>
            <tr>
              <th>Metric</th>
              <th>You</th>
              <th>Optimal</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map(({ key, label }) => {
              const you = userMetrics[key];
              const optimal = optimalMetrics[key];
              const delta = you - optimal;
              return (
                <tr key={key} data-testid={`metric-${key}`}>
                  <td>{label}</td>
                  <td>{you}</td>
                  <td>{optimal}</td>
                  <td data-testid={`delta-${key}`}>
                    {delta > 0 ? '+' : ''}
                    {delta}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {onNext ? (
          <button type="button" onClick={onNext}>
            Next puzzle
          </button>
        ) : null}
      </aside>
    </div>
  );
}
