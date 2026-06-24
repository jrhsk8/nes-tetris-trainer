/**
 * Free-positioning input (#10, #43, #56, #81, #89) — the player pilots a SINGLE
 * free-floating piece to any collision-reachable resting position and confirms
 * it. There is no second drop-shadow: the one solid, colour-coded piece is drawn
 * exactly where you are flying it (WYSIWYG), so the old "awkward partial ghost" (a
 * bright active piece one row above a separate muted shadow) is gone at the root
 * (#89).
 *
 * The piece spawns floating at the top row and never auto-falls — it is a free
 * cursor. While floating it is the plain bright sprite; the moment it **rests**
 * (fits and cannot fall one row) it gains a **glow**, the unmistakable "ready to
 * lock" cue. **Confirm is enabled only while resting**, so every locked placement
 * is a gradeable resting placement.
 *
 * Inputs (NES-faithful, no SRS): a left/right press shifts ONE column then settles
 * by gravity (tuck-seeking — slides under an overhang when it fits, rides up a
 * higher neighbour by a step); **spin** (#88) rotates in place at a fixed column,
 * snapping to the nearest reachable row at the new rotation (preferring at-or-
 * below, riding up only on the floor) so a piece resting on the stack can still
 * spin; soft-drop carries the piece down one row and **auto-repeats while held**;
 * raise lifts one row (to lift off the floor for a spin). There is **no
 * hard-drop**.
 *
 * Every move is gated on the {@link reachableStates} set — the SAME BFS the
 * generator enumerates placements with — so a confirmable position always matches
 * the generator's reachability cell-for-cell (parity, #56). Confirm emits exactly
 * the outlined resting cells (carrying `row`, so a tuck is pinned, never re-dropped
 * onto a ledge). What you see is what you get.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COLS,
  ROWS,
  ORIENTATIONS,
  fitsAt,
  isResting,
  pieceCells,
  reachableStates,
  spin,
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

  // Reset the floating piece to spawn AND auto-focus the board on puzzle/piece
  // load (#64, #81). The component instance is reused across placement 1 → 2
  // (and new puzzles), so without this the second piece would inherit the first's
  // column/row/rotation — harmless under pure translation, but with gravity-on
  // -shift a stale low row sits inside the piece just placed and blocks every
  // lateral, stranding the piece. Re-runs whenever the piece or board changes.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setRotation(0);
    setCol(spawnColumn(board, piece));
    setRow(0);
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
  // Bounds-check before hashing (#81): `stateKey` packs (rot,row,col) assuming
  // each is in range, so an out-of-range row/col (e.g. a pure-translation press
  // toward col -1/COLS) would ALIAS a valid in-range state and falsely read as
  // reachable. Reject out-of-range coordinates up front so a move can never walk
  // the piece off the board.
  const canReach = useCallback(
    (rot: number, r: number, c: number) =>
      r >= 0 && r < ROWS && c >= 0 && c < COLS && reachable.has(stateKey(rot, r, c)),
    [reachable],
  );

  // The SINGLE free-floating outline (#89), drawn exactly where the player is
  // piloting it — one cursor, no drop-shadow.
  const outlineCells = useMemo(
    () => pieceCells(piece, rotation, row, col),
    [piece, rotation, row, col],
  );
  // Resting = fits here AND cannot fall one row (the lock condition). Drives the
  // glow and gates Confirm, so every locked placement is a resting placement.
  const resting = useMemo(
    () => isResting(board, piece, rotation, row, col),
    [board, piece, rotation, row, col],
  );

  // One lateral step into the adjacent column `dir`, settled to the nearest
  // reachable resting spot there (#81). Two behaviours fall out of one rule:
  //   - If the piece fits at the CURRENT row in the target column, slide straight
  //     across at that level (and then fall by gravity into any well) — this
  //     preserves the tuck: from the low row beside an overhang the shift slides
  //     UNDER it into the pocket.
  //   - Otherwise the neighbour's surface is higher (a bump or a wall), so RIDE UP
  //     to the lowest reachable row in that column and rest on its surface — so a
  //     settled piece always slides freely across the board instead of stalling
  //     against the first bump (the owner's "it should slide like it used to").
  // The ride-up climbs only to the column's surface (the first reachable row going
  // up), never jumping to a far high pocket. Returns the new (row, col), or null if
  // the column is off-board or unreachable at any depth from here.
  const slideStep = useCallback(
    (rot: number, r: number, c: number, dir: -1 | 1): { row: number; col: number } | null => {
      const nc = c + dir;
      if (nc < 0 || nc >= COLS) return null;
      let nr = r;
      while (nr >= 0 && !canReach(rot, nr, nc)) nr--;
      if (nr < 0) return null;
      return { col: nc, row: settleRow(board, piece, rot, nr, nc) };
    },
    [canReach, board, piece],
  );

  const lateral = useCallback(
    (dir: -1 | 1) => {
      const next = slideStep(rotation, row, col, dir);
      if (!next) return;
      setCol(next.col);
      setRow(next.row);
    },
    [slideStep, rotation, row, col],
  );

  const moveLeft = useCallback(() => lateral(-1), [lateral]);
  const moveRight = useCallback(() => lateral(1), [lateral]);

  // Mobile drag-to-position (#69, #81): the whole board is one control surface —
  // drag anywhere and the piece's column follows the finger (no need to grab the
  // few-cell piece), using the SAME shift-then-settle rule as L/R, so the piece
  // walks the surface and drops into a well under the finger. Depth fine-tuning
  // (lifting for a spin) stays on the ▲/▼ buttons and rotation on the rotate
  // buttons — NOT vertical drag — so the gesture is unambiguous; commit is the
  // explicit Confirm button, NOT lift-to-place, so a stray touch can never drop
  // the piece. Desktop keyboard/buttons are untouched (this is an additional input).
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
      // Walk toward the finger one column at a time using the SAME shift-then
      // -settle rule as keyboard L/R (#81): each step rides up over any bump and
      // falls to rest, so the piece tracks the finger across the whole surface
      // (climbing walls, dropping into wells) instead of stalling at the first bump.
      const step = targetCol > col ? 1 : -1;
      let c = col;
      let r = row;
      while (c !== targetCol) {
        const next = slideStep(rotation, r, c, step);
        if (!next) break;
        c = next.col;
        r = next.row;
      }
      if (c !== col) {
        setCol(c);
        setRow(r);
      }
    },
    [slideStep, rotation, row, col],
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

  // Hold-to-repeat soft-drop (#89): pressing ▼ drops once and then auto-repeats
  // quickly while held, so the piece carries down with a single press; releasing
  // (or the pointer leaving) stops it. There is no hard-drop. Keyboard soft-drop
  // repeats via the browser's own key-repeat on the board handler.
  const dropTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopSoftDrop = useCallback(() => {
    if (dropTimer.current !== null) {
      clearInterval(dropTimer.current);
      dropTimer.current = null;
    }
  }, []);
  const startSoftDrop = useCallback(() => {
    softDrop();
    if (dropTimer.current !== null) return;
    dropTimer.current = setInterval(softDrop, 60);
  }, [softDrop]);
  useEffect(() => stopSoftDrop, [stopSoftDrop]);

  // The inverse of soft-drop (#56): step the floating piece UP one row so an
  // overshoot can be undone to reach a tuck/spin row. Gated on the reachable set,
  // so it can only revisit a genuinely reachable state — never lift the piece
  // into an isolated pocket the generator never enumerated.
  const raise = useCallback(() => {
    setRow((r) => (canReach(rotation, r - 1, col) ? r - 1 : r));
  }, [canReach, rotation, col]);

  // Spin (#88/#89): rotate in place at the FIXED column, snapping to the nearest
  // reachable row at the new rotation — preferring at-or-below (into a pocket),
  // riding up only when forced (a piece resting on the floor/stack). Defers to
  // the core `spin` helper, so the result is always a reachable, generator-
  // enumerated state and a piece on the floor can still spin (no silent no-op).
  const rotateBy = useCallback(
    (dir: 'cw' | 'ccw') => {
      if (rotationCount < 2) return;
      const next = spin(board, piece, rotation, row, col, dir, reachableList);
      if (next) {
        setRotation(next.rotation);
        setRow(next.row);
        setCol(next.col);
      }
    },
    [board, piece, rotation, row, col, reachableList, rotationCount],
  );

  const rotateCw = useCallback(() => rotateBy('cw'), [rotateBy]);
  const rotateCcw = useCallback(() => rotateBy('ccw'), [rotateBy]);

  // Confirm locks exactly the outlined cells — gated on `resting`, so a confirm
  // can only ever emit a gradeable resting placement (the glow is the cue).
  const confirm = useCallback(() => {
    if (resting) onConfirm({ rotation, col, row });
  }, [resting, onConfirm, rotation, col, row]);

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
      data-resting={resting}
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
          outlineCells={outlineCells}
          outlinePiece={piece}
          outlineResting={resting}
        />
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
          onPointerDown={startSoftDrop}
          onPointerUp={stopSoftDrop}
          onPointerLeave={stopSoftDrop}
          onPointerCancel={stopSoftDrop}
          aria-label="Soft drop"
          disabled={!canReach(rotation, row + 1, col)}
        >
          ▼
        </button>
        <button
          type="button"
          onClick={confirm}
          aria-label="Confirm placement"
          disabled={!resting}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
