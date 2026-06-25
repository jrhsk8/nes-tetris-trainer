/**
 * Free-positioning input (#10, #43, #56, #81, #89) — the player pilots a SINGLE
 * free-floating piece to any collision-reachable resting position and confirms
 * it. Delegates all move logic to {@link createMoveEngine}; this module handles
 * keyboard/pointer dispatch and rendering only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLS, ORIENTATIONS, type ColorGrid, type Grid, type Piece, type Placement } from '@trainer/core';
import { Board } from './Board.js';
import { DEFAULT_BINDINGS, resolveAction, type KeyBindings } from './keybindings.js';
import { createMoveEngine, type MoveEngine } from './move-engine.js';

export interface PlacementInputProps {
  board: Grid;
  colorGrid?: ColorGrid;
  piece: Piece;
  onConfirm: (placement: Placement) => void;
  label?: string;
  bindings?: KeyBindings;
}

export function PlacementInput({
  board,
  colorGrid,
  piece,
  onConfirm,
  label,
  bindings = DEFAULT_BINDINGS,
}: PlacementInputProps) {
  const [, forceRender] = useState(0);
  const engineRef = useRef<MoveEngine | null>(null);

  const engine = useMemo(() => {
    const e = createMoveEngine(board, piece, () => forceRender((n) => n + 1));
    engineRef.current = e;
    return e;
  }, [board, piece]);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    engine.reset();
    rootRef.current?.focus();
  }, [engine]);

  const s = engine.state();

  // Mobile drag-to-position (#69, #81).
  const boardSurfaceRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const dragToClientX = useCallback(
    (clientX: number) => {
      const gridEl = boardSurfaceRef.current?.querySelector('.board');
      if (!gridEl) return;
      const rect = gridEl.getBoundingClientRect();
      if (rect.width === 0) return;
      const fingerCol = Math.floor(((clientX - rect.left) / rect.width) * COLS);
      const cols = ORIENTATIONS[piece][s.rotation].map(([, c]) => c);
      const minC = Math.min(...cols);
      const maxC = Math.max(...cols);
      const lo = -minC;
      const hi = COLS - 1 - maxC;
      const targetCol = Math.min(hi, Math.max(lo, fingerCol - Math.round((minC + maxC) / 2)));
      engine.dragToCol(targetCol);
    },
    [engine, piece, s.rotation],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      dragging.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragToClientX(event.clientX);
    },
    [dragToClientX],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging.current) return;
      dragToClientX(event.clientX);
    },
    [dragToClientX],
  );

  const endDrag = useCallback((event: React.PointerEvent) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  // Hold-to-repeat soft-drop (#89).
  const dropTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopSoftDrop = useCallback(() => {
    if (dropTimer.current !== null) {
      clearInterval(dropTimer.current);
      dropTimer.current = null;
    }
  }, []);
  const startSoftDrop = useCallback(() => {
    engine.softDrop();
    if (dropTimer.current !== null) return;
    dropTimer.current = setInterval(() => engine.softDrop(), 60);
  }, [engine]);
  useEffect(() => stopSoftDrop, [stopSoftDrop]);

  const confirm = useCallback(() => {
    const result = engine.confirm();
    if (result) onConfirm(result);
  }, [engine, onConfirm]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const action = resolveAction(bindings, event.key);
      if (!action) return;
      event.preventDefault();
      switch (action) {
        case 'move-left': engine.moveLeft(); break;
        case 'move-right': engine.moveRight(); break;
        case 'rotate-cw': engine.rotateCw(); break;
        case 'rotate-ccw': engine.rotateCcw(); break;
        case 'soft-drop': engine.softDrop(); break;
        case 'move-up': engine.raise(); break;
        case 'confirm': confirm(); break;
      }
    },
    [bindings, engine, confirm],
  );

  const canRaise = s.row > 0;
  const canDrop = !s.resting;

  return (
    <div
      ref={rootRef}
      className="placement-input"
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-label="placement input"
      data-rotation={s.rotation}
      data-col={s.col}
      data-row={s.row}
      data-resting={s.resting}
    >
      {label ? <p className="placement-label">{label}</p> : null}
      <div
        ref={boardSurfaceRef}
        className="placement-board-surface"
        aria-label="board drag surface"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Board
          grid={board}
          colorGrid={colorGrid}
          outlineCells={s.outlineCells}
          outlinePiece={piece}
          outlineResting={s.resting}
          landingCells={s.landingCells}
          landingPiece={piece}
        />
      </div>
      <div className="placement-controls" role="group" aria-label="placement controls">
        <button type="button" onClick={() => engine.moveLeft()} aria-label="Move left">
          &#9664;
        </button>
        <button
          type="button"
          onClick={() => engine.rotateCcw()}
          aria-label="Rotate counter-clockwise"
          disabled={ORIENTATIONS[piece].length < 2}
        >
          &#8634;
        </button>
        <button
          type="button"
          onClick={() => engine.rotateCw()}
          aria-label="Rotate clockwise"
          disabled={ORIENTATIONS[piece].length < 2}
        >
          &#8635;
        </button>
        <button type="button" onClick={() => engine.moveRight()} aria-label="Move right">
          &#9654;
        </button>
        <button
          type="button"
          onClick={() => engine.raise()}
          aria-label="Move up"
          disabled={!canRaise}
        >
          &#9650;
        </button>
        <button
          type="button"
          onPointerDown={startSoftDrop}
          onPointerUp={stopSoftDrop}
          onPointerLeave={stopSoftDrop}
          onPointerCancel={stopSoftDrop}
          aria-label="Soft drop"
          disabled={!canDrop}
        >
          &#9660;
        </button>
        <button
          type="button"
          onClick={confirm}
          aria-label="Confirm placement"
          disabled={!s.resting}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
