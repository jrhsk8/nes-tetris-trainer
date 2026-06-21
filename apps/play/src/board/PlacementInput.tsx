/**
 * Free-positioning ghost input (#10, #43) — the player manoeuvres a ghost of
 * `piece` to any collision-reachable resting position and confirms it. Unlike
 * the old column-only ghost this can express **tucks and spins**: there is no
 * timer, but the four real inputs (left, right, rotate, soft-drop) are
 * collision-aware, so the player can soft-drop into an open well and slide the
 * piece UNDER an overhang before locking.
 *
 * The piece has a floating position `(rotation, row, col)`; the ghost is drawn
 * where it would currently land (the floating position dropped straight to
 * rest), and confirming emits exactly that resting placement (carrying its
 * `row`, so a tuck is pinned and not re-dropped onto the ledge). What you see is
 * what you get.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  COLS,
  ORIENTATIONS,
  fitsAt,
  pieceCells,
  type ColorGrid,
  type Grid,
  type Piece,
  type Placement,
} from '@trainer/core';
import { Board } from './Board.js';
import { DEFAULT_BINDINGS, resolveAction, type KeyBindings } from './keybindings.js';

/** The row a piece at `(rotation, col)` settles to if dropped straight from `row`. */
function settleRow(board: Grid, piece: Piece, rotation: number, row: number, col: number): number {
  let r = row;
  while (fitsAt(board, piece, rotation, r + 1, col)) r++;
  return r;
}

/** A starting column near the spawn where `piece` fits at the top of the board. */
function spawnColumn(board: Grid, piece: Piece): number {
  for (let d = 0; d < COLS; d++) {
    for (const col of d === 0 ? [SPAWN_COLUMN] : [SPAWN_COLUMN - d, SPAWN_COLUMN + d]) {
      if (col >= 0 && col < COLS && fitsAt(board, piece, 0, 0, col)) return col;
    }
  }
  return 0;
}

export interface PlacementInputProps {
  /** The board the piece is placed on. */
  board: Grid;
  /** Optional colour grid parallel to `board` for the existing stack (#28). */
  colorGrid?: ColorGrid;
  /** The piece being placed. */
  piece: Piece;
  /** Called with the chosen resting placement when the player confirms. */
  onConfirm: (placement: Placement) => void;
  /** Optional instruction shown above the controls. */
  label?: string;
  /** Key bindings for the actions (defaults to {@link DEFAULT_BINDINGS}). */
  bindings?: KeyBindings;
}

/** A reasonable starting column: near the NES spawn column. */
const SPAWN_COLUMN = 3;

export function PlacementInput({
  board,
  colorGrid,
  piece,
  onConfirm,
  label,
  bindings = DEFAULT_BINDINGS,
}: PlacementInputProps) {
  const rotationCount = ORIENTATIONS[piece].length;
  const [rotation, setRotation] = useState(0);
  const [col, setCol] = useState(() => spawnColumn(board, piece));
  const [row, setRow] = useState(0);

  // Where the piece would land from its current floating position — what the
  // ghost shows and what `confirm` emits (the displayed rest, pinned by `row`).
  const restRow = useMemo(
    () => settleRow(board, piece, rotation, row, col),
    [board, piece, rotation, row, col],
  );
  const ghostCells = useMemo(
    () => pieceCells(piece, rotation, restRow, col),
    [piece, rotation, restRow, col],
  );

  const moveLeft = useCallback(() => {
    setCol((c) => (fitsAt(board, piece, rotation, row, c - 1) ? c - 1 : c));
  }, [board, piece, rotation, row]);

  const moveRight = useCallback(() => {
    setCol((c) => (fitsAt(board, piece, rotation, row, c + 1) ? c + 1 : c));
  }, [board, piece, rotation, row]);

  const softDrop = useCallback(() => {
    setRow((r) => (fitsAt(board, piece, rotation, r + 1, col) ? r + 1 : r));
  }, [board, piece, rotation, col]);

  // Rotate by `delta` orientation steps (+1 = clockwise, -1 = counter-clockwise),
  // in place — only if the rotated piece still fits at the current position.
  const rotateBy = useCallback(
    (delta: number) => {
      if (rotationCount < 2) return;
      const next = (rotation + delta + rotationCount) % rotationCount;
      if (fitsAt(board, piece, next, row, col)) setRotation(next);
    },
    [board, piece, rotation, row, col, rotationCount],
  );

  const rotateCw = useCallback(() => rotateBy(1), [rotateBy]);
  const rotateCcw = useCallback(() => rotateBy(-1), [rotateBy]);

  const confirm = useCallback(
    () => onConfirm({ rotation, col, row: restRow }),
    [onConfirm, rotation, col, restRow],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const action = resolveAction(bindings, event.key);
      if (!action) return;
      event.preventDefault();
      switch (action) {
        case 'move-left':
          moveLeft();
          break;
        case 'move-right':
          moveRight();
          break;
        case 'rotate-cw':
          rotateCw();
          break;
        case 'rotate-ccw':
          rotateCcw();
          break;
        case 'soft-drop':
          softDrop();
          break;
        case 'confirm':
          confirm();
          break;
      }
    },
    [bindings, moveLeft, moveRight, rotateCw, rotateCcw, softDrop, confirm],
  );

  return (
    <div
      className="placement-input"
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-label="placement input"
      data-rotation={rotation}
      data-col={col}
      data-row={row}
    >
      {label ? <p className="placement-label">{label}</p> : null}
      <Board grid={board} colorGrid={colorGrid} ghostCells={ghostCells} ghostPiece={piece} />
      <div className="placement-controls" role="group" aria-label="placement controls">
        <button type="button" onClick={moveLeft} aria-label="Move left">
          ◀
        </button>
        <button
          type="button"
          onClick={rotateCcw}
          aria-label="Rotate counter-clockwise"
          disabled={rotationCount < 2}
        >
          ↺
        </button>
        <button
          type="button"
          onClick={rotateCw}
          aria-label="Rotate clockwise"
          disabled={rotationCount < 2}
        >
          ↻
        </button>
        <button type="button" onClick={moveRight} aria-label="Move right">
          ▶
        </button>
        <button
          type="button"
          onClick={softDrop}
          aria-label="Soft drop"
          disabled={!fitsAt(board, piece, rotation, row + 1, col)}
        >
          ▼
        </button>
        <button type="button" onClick={confirm} aria-label="Confirm placement">
          Confirm
        </button>
      </div>
    </div>
  );
}
