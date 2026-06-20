/**
 * Feedback view (#12, #22, #25) — the teaching payoff (docs/PRD-v1.md
 * "Feedback").
 *
 * After an attempt it replays the stored optimal two-ply line as a falling
 * animation (#25): each piece spawns at the top, slides into its column and
 * drops to rest on a GPU transform overlay, then locks into the stack; a line
 * clear flashes and collapses. With `prefers-reduced-motion` it snaps straight
 * to the settled board. Alongside it shows geometric metric deltas (holes,
 * bumpiness, height) of the player's result versus the optimal result — the
 * optimal-side metrics are precomputed at generation; the player-side metrics
 * are computed here, client-side, via @trainer/core (#3). No engine call is
 * made.
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
import { Board } from '../board/Board.js';
import { PIECE_GROUP, blockBackground } from '../board/nes.js';
import { buildReplay, finalBoard, type Keyframe, type ReplayOverlay } from './replay.js';

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
  /** Milliseconds per animation step (also the falling-piece transition time). */
  stepMs?: number;
  /** Whether the player solved the puzzle (shows the outcome heading). */
  solved?: boolean;
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
  stepMs = 320,
  solved,
  ratingChange,
  onNext,
}: FeedbackProps) {
  const [reduced] = useState(prefersReducedMotion);

  const timeline = useMemo<Keyframe[]>(() => {
    const keyframes = buildReplay(board0, piece1, piece2, optimalLine);
    // Reduced motion: jump straight to the settled board, no falling/flash.
    if (reduced) {
      return [{ grid: finalBoard(board0, piece1, piece2, optimalLine), label: 'Optimal line' }];
    }
    return keyframes;
  }, [board0, piece1, piece2, optimalLine, reduced]);

  const userMetrics = useMemo(
    () => boardMetrics(applyUserLine(board0, piece1, piece2, userLine)),
    [board0, piece1, piece2, userLine],
  );

  const [step, setStep] = useState(0);

  // Restart the replay whenever the timeline changes (a new puzzle/attempt).
  useEffect(() => setStep(0), [timeline]);

  useEffect(() => {
    if (step >= timeline.length - 1) return;
    const timer = setTimeout(() => setStep((s) => s + 1), stepMs);
    return () => clearTimeout(timer);
  }, [step, timeline.length, stepMs]);

  const frame = timeline[Math.min(step, timeline.length - 1)];

  return (
    <div className="feedback">
      <div className="play-center feedback-board" data-testid="board-center">
        <p className="play-instruction">The optimal line:</p>
        <Board
          grid={frame.grid}
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
