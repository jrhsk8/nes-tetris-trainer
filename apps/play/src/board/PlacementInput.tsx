/**
 * Ghost-piece input (#10) — lets the player move and rotate a ghost of `piece`
 * to a final resting placement and confirm it. There is no real-time play and
 * no reachability model: the player picks a resting column + rotation, the
 * ghost shows exactly where it would land, and confirming emits that placement.
 *
 * Because the ghost is drawn with `restingCells(board, piece, placement)` and
 * the same `placement` is emitted, the emitted placement always matches what is
 * shown.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  COLS,
  ORIENTATIONS,
  restingCells,
  type Grid,
  type Piece,
  type Placement,
} from '@trainer/core';
import { Board } from './Board.js';

/** Columns at which `piece` (in `rotation`) can legally rest on `board`. */
function legalColumns(board: Grid, piece: Piece, rotation: number): number[] {
  const cols: number[] = [];
  for (let col = 0; col < COLS; col++) {
    if (restingCells(board, piece, { rotation, col })) cols.push(col);
  }
  return cols;
}

/** The value in `options` closest to `target` (options assumed non-empty). */
function nearest(target: number, options: number[]): number {
  return options.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best));
}

export interface PlacementInputProps {
  /** The board the piece is placed on. */
  board: Grid;
  /** The piece being placed. */
  piece: Piece;
  /** Called with the chosen resting placement when the player confirms. */
  onConfirm: (placement: Placement) => void;
  /** Optional instruction shown above the controls. */
  label?: string;
}

/** A reasonable starting column: the legal column nearest the spawn column. */
const SPAWN_COLUMN = 3;

export function PlacementInput({ board, piece, onConfirm, label }: PlacementInputProps) {
  const rotationCount = ORIENTATIONS[piece].length;
  const [rotation, setRotation] = useState(0);
  const [col, setCol] = useState(() => {
    const cols = legalColumns(board, piece, 0);
    return cols.length ? nearest(SPAWN_COLUMN, cols) : 0;
  });

  const columns = useMemo(() => legalColumns(board, piece, rotation), [board, piece, rotation]);
  const ghostCells = useMemo(
    () => restingCells(board, piece, { rotation, col }) ?? [],
    [board, piece, rotation, col],
  );

  const moveLeft = useCallback(() => {
    setCol((current) => {
      const index = columns.indexOf(current);
      return index > 0 ? columns[index - 1] : current;
    });
  }, [columns]);

  const moveRight = useCallback(() => {
    setCol((current) => {
      const index = columns.indexOf(current);
      return index >= 0 && index < columns.length - 1 ? columns[index + 1] : current;
    });
  }, [columns]);

  const rotate = useCallback(() => {
    if (rotationCount < 2) return;
    const nextRotation = (rotation + 1) % rotationCount;
    const nextColumns = legalColumns(board, piece, nextRotation);
    setRotation(nextRotation);
    // Keep the column if still legal, else snap to the nearest legal column.
    setCol((current) =>
      nextColumns.includes(current)
        ? current
        : nextColumns.length
          ? nearest(current, nextColumns)
          : current,
    );
  }, [board, piece, rotation, rotationCount]);

  const confirm = useCallback(() => onConfirm({ rotation, col }), [onConfirm, rotation, col]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          moveLeft();
          break;
        case 'ArrowRight':
          event.preventDefault();
          moveRight();
          break;
        case 'ArrowUp':
          event.preventDefault();
          rotate();
          break;
        case 'Enter':
          event.preventDefault();
          confirm();
          break;
      }
    },
    [moveLeft, moveRight, rotate, confirm],
  );

  return (
    <div
      className="placement-input"
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-label="placement input"
    >
      {label ? <p className="placement-label">{label}</p> : null}
      <Board grid={board} ghostCells={ghostCells} />
      <div className="placement-controls" role="group" aria-label="placement controls">
        <button type="button" onClick={moveLeft} aria-label="Move left">
          ◀
        </button>
        <button type="button" onClick={rotate} aria-label="Rotate" disabled={rotationCount < 2}>
          ⟳
        </button>
        <button type="button" onClick={moveRight} aria-label="Move right">
          ▶
        </button>
        <button type="button" onClick={confirm} aria-label="Confirm placement">
          Confirm
        </button>
      </div>
    </div>
  );
}
