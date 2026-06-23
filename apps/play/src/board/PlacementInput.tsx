/**
 * Free-positioning ghost input (#10, #43, #56) — the player manoeuvres a ghost
 * of `piece` to any collision-reachable resting position and confirms it. Unlike
 * the old column-only ghost this can express **tucks and spins**: there is no
 * timer, and the moves (left, right, rotate, soft-drop, and the soft-drop
 * inverse "move up") are gated on the engine-shared reachability model, so the
 * player can soft-drop into an open well and slide the piece UNDER an overhang
 * before locking.
 *
 * The reachable floating states come from {@link reachableStates} — the SAME BFS
 * the generator enumerates placements with — so the set of positions the player
 * can confirm matches the generator's reachability cell-for-cell (parity, #56).
 * Crucially `move up` (the inverse of soft-drop) is included: soft-drop alone is
 * irreversible, so overshooting the one row where a tuck/spin slides in used to
 * strand the piece with no way back. Every move simply walks to an adjacent
 * reachable state; it can never escape the reachable set, so it can never reach
 * a placement the generator did not enumerate.
 *
 * The piece has a floating position `(rotation, row, col)`; the ghost is drawn
 * where it would currently land (the floating position dropped straight to
 * rest), and confirming emits exactly that resting placement (carrying its
 * `row`, so a tuck is pinned and not re-dropped onto the ledge). What you see is
 * what you get.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COLS,
  ROWS,
  ORIENTATIONS,
  fitsAt,
  lateralMove,
  moveToColumn,
  pieceCells,
  reachableStates,
  type ColorGrid,
  type Grid,
  type Piece,
  type Placement,
} from '@trainer/core';
import { Board } from './Board.js';
import { DEFAULT_BINDINGS, resolveAction, type KeyBindings } from './keybindings.js';

/** A packed key for a `(rotation, row, col)` floating state (mirrors the core BFS). */
function stateKey(rotation: number, row: number, col: number): number {
  return (rotation * ROWS + row) * COLS + col;
}

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

  // Auto-focus the board on puzzle/piece load (#64) so the whole loop is no-mouse:
  // keystrokes land on the placement input immediately, no click required. Re-runs
  // when the piece changes (placement 1 → 2) and on each new puzzle.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, [board, piece]);

  // Every floating state the player may manoeuvre into — the generator's
  // reachability model (#56). A move is allowed iff its target state is in here,
  // so the confirmable placements match the generator's cell-for-cell and a move
  // can never escape onto a placement the generator did not enumerate.
  const reachableList = useMemo(() => reachableStates(board, piece), [board, piece]);
  const reachable = useMemo(() => {
    const set = new Set<number>();
    for (const s of reachableList) set.add(stateKey(s.rotation, s.row, s.col));
    return set;
  }, [reachableList]);
  const canReach = useCallback(
    (rot: number, r: number, c: number) => reachable.has(stateKey(rot, r, c)),
    [reachable],
  );

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

  // Tuck-seeking lateral movement (#76, #68): a press moves to the reachable
  // position in the target column NEAREST the current row, preferring at-or-below
  // — so it tucks INTO a pocket instead of ejecting to the column top; it rides
  // up only when nothing at-or-below is reachable. Blocked only when the target
  // column is full to the top or the move would go off-screen. {@link lateralMove}
  // picks from the reachable set, so the superset binding invariant holds.
  const lateral = useCallback(
    (dir: -1 | 1) => {
      const next = lateralMove(board, piece, rotation, row, col, dir, reachableList);
      if (!next) return;
      setCol(next.col);
      setRow(next.row);
    },
    [board, piece, rotation, row, col, reachableList],
  );

  const moveLeft = useCallback(() => lateral(-1), [lateral]);
  const moveRight = useCallback(() => lateral(1), [lateral]);

  // Mobile drag-to-position (#69): the whole board is one control surface — drag
  // anywhere and the piece's column follows the finger (no need to grab the few
  // -cell piece), using the SAME free/ride-up rule as L/R (#68). Depth (tucks)
  // stays on the ▲/▼ buttons and rotation on the rotate buttons — NOT vertical
  // drag — so the gesture is unambiguous; commit is the explicit Confirm button,
  // NOT lift-to-place, so a stray touch can never drop the piece. Desktop
  // keyboard/buttons are untouched (this is an additional input).
  const boardSurfaceRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const dragToClientX = useCallback(
    (clientX: number) => {
      const gridEl = boardSurfaceRef.current?.querySelector('.board');
      if (!gridEl) return;
      const rect = gridEl.getBoundingClientRect();
      if (rect.width === 0) return; // no layout (e.g. jsdom without a mocked rect)
      const fingerCol = Math.floor(((clientX - rect.left) / rect.width) * COLS);
      // Center the piece's column span on the finger cell, then clamp to the
      // columns where the piece fits on the board so edge drags stay responsive.
      const cols = ORIENTATIONS[piece][rotation].map(([, c]) => c);
      const minC = Math.min(...cols);
      const maxC = Math.max(...cols);
      const lo = -minC;
      const hi = COLS - 1 - maxC;
      const targetCol = Math.min(hi, Math.max(lo, fingerCol - Math.round((minC + maxC) / 2)));
      const next = moveToColumn(board, piece, rotation, row, targetCol, reachableList);
      if (next) {
        setCol(next.col);
        setRow(next.row);
      }
    },
    [board, piece, rotation, row, reachableList],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return; // primary pointer / touch only
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

  const softDrop = useCallback(() => {
    setRow((r) => (canReach(rotation, r + 1, col) ? r + 1 : r));
  }, [canReach, rotation, col]);

  // The inverse of soft-drop (#56): step the floating piece UP one row so an
  // overshoot can be undone to reach a tuck/spin row. Gated on the reachable set,
  // so it can only revisit a genuinely reachable state — never lift the piece
  // into an isolated pocket the generator never enumerated.
  const raise = useCallback(() => {
    setRow((r) => (canReach(rotation, r - 1, col) ? r - 1 : r));
  }, [canReach, rotation, col]);

  // Rotate by `delta` orientation steps (+1 = clockwise, -1 = counter-clockwise),
  // in place — only if the rotated piece is reachable at the current position.
  const rotateBy = useCallback(
    (delta: number) => {
      if (rotationCount < 2) return;
      const next = (rotation + delta + rotationCount) % rotationCount;
      if (canReach(next, row, col)) setRotation(next);
    },
    [canReach, rotation, row, col, rotationCount],
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
        case 'move-up':
          raise();
          break;
        case 'confirm':
          confirm();
          break;
      }
    },
    [bindings, moveLeft, moveRight, rotateCw, rotateCcw, softDrop, raise, confirm],
  );

  return (
    <div
      ref={rootRef}
      className="placement-input"
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-label="placement input"
      data-rotation={rotation}
      data-col={col}
      data-row={row}
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
        <Board grid={board} colorGrid={colorGrid} ghostCells={ghostCells} ghostPiece={piece} />
      </div>
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
          onClick={raise}
          aria-label="Move up"
          disabled={!canReach(rotation, row - 1, col)}
        >
          ▲
        </button>
        <button
          type="button"
          onClick={softDrop}
          aria-label="Soft drop"
          disabled={!canReach(rotation, row + 1, col)}
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
