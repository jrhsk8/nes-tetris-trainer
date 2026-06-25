/**
 * Collision-aware reachability and resting placements (#37, v2 overhaul issue A).
 *
 * The hard-drop-only {@link Placement} (`{ rotation, col }`) in `board.ts` can
 * only describe a piece dropped straight down a column. v2 grades by where a
 * piece *rests* — including **tucks** (slid under an overhang) and **spins**
 * (rotated into a pocket) — so we need a richer placement that pins an exact
 * resting position, plus a way to enumerate every position the player could
 * legally manoeuvre a piece into.
 *
 * {@link enumerateResting} does that with a BFS over the four player inputs
 * (left, right, rotate, soft-drop) from the spawn row. The enumerated set is a
 * **superset** of every placement free-positioning input (#43) can produce —
 * the binding invariant for outcome-matching, so a legal tuck is never rejected
 * as "unknown combo".
 *
 * {@link boardKey} is the **canonical outcome key**: the locked-cell set after a
 * placement, as the 200-char binary string. Matching by this key (#42) is
 * path-independent and rotation-numbering-independent — two encodings that land
 * the same cells grade identically.
 *
 * Pure: no engine, network, or DOM. The binary {@link Grid} stays colour-blind.
 */

import {
  ROWS,
  COLS,
  cloneBoard,
  clearFullRows,
  encodeBoard,
  type Grid,
  type Placement,
  type Line,
} from './board.js';
import { ORIENTATIONS, type Piece } from './pieces.js';

/**
 * NES rotation offset table. Each piece's rotations live inside a fixed
 * bounding box in the NES ROM (3×3 for T/J/L, 4×4-ish for I, etc.), and
 * the box's position stays fixed when the player rotates. Our orientation
 * tables use **tight** bounding boxes (no empty border rows/cols), so the
 * tight-bbox top-left shifts relative to the NES origin on some rotations.
 *
 * `ROTATION_OFFSETS[piece][rot]` is the `[dRow, dCol]` offset of the tight
 * bbox's top-left from the NES fixed-box origin for that rotation state.
 * The delta to apply when rotating from state A to state B is
 * `offset[B] − offset[A]` (see {@link rotationDelta}).
 */
const ROTATION_OFFSETS: Record<Piece, readonly (readonly [number, number])[]> = {
  O: [[0, 0]],
  I: [[0, 0], [0, 2]],
  T: [[0, 0], [0, 1], [1, 0], [0, 0]],
  S: [[0, 0], [0, 1]],
  Z: [[0, 0], [0, 1]],
  J: [[0, 0], [0, 1], [1, 0], [0, 0]],
  L: [[0, 0], [0, 1], [1, 0], [0, 0]],
};

/**
 * The `[dRow, dCol]` to add to the tight-bbox position when rotating
 * `piece` from `fromRot` to `toRot`, so the NES fixed-box origin stays
 * fixed (the piece spins in place rather than shifting).
 */
export function rotationDelta(
  piece: Piece,
  fromRot: number,
  toRot: number,
): [number, number] {
  const offsets = ROTATION_OFFSETS[piece];
  const from = offsets[fromRot];
  const to = offsets[toRot];
  return [to[0] - from[0], to[1] - from[1]];
}

/**
 * A resting placement that can express any collision-reachable position — a
 * hard drop, a tuck, or a spin. Unlike the hard-drop-only {@link Placement} it
 * pins the full board offset of the piece's (normalized) bounding box: its
 * top-left corner sits at `(row, col)`. `rotation` indexes the piece's
 * orientation table (canonical `0..len-1`).
 */
export interface RestingPlacement {
  rotation: number;
  row: number;
  col: number;
}

/** Normalize a (possibly wrapping) rotation index to `0..len-1` for `piece`. */
function normRotation(piece: Piece, rotation: number): number {
  const len = ORIENTATIONS[piece].length;
  return ((rotation % len) + len) % len;
}

/**
 * The board cells `piece` occupies at `rotation` with its bounding box's
 * top-left corner at `(row, col)`. Returns `[boardRow, boardCol]` pairs.
 */
export function pieceCells(
  piece: Piece,
  rotation: number,
  row: number,
  col: number,
): Array<[number, number]> {
  const orientations = ORIENTATIONS[piece];
  const cells = orientations[normRotation(piece, rotation)];
  return cells.map(([r, c]) => [r + row, c + col] as [number, number]);
}

/** True if every cell of the placement is on the board and on an empty square. */
export function fitsAt(
  grid: Grid,
  piece: Piece,
  rotation: number,
  row: number,
  col: number,
): boolean {
  for (const [r, c] of pieceCells(piece, rotation, row, col)) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || grid[r][c]) return false;
  }
  return true;
}

/**
 * True if the piece fits at `(rotation, row, col)` AND cannot move one row down
 * — i.e. it rests on the stack or the floor. This is the lock condition.
 */
export function isResting(
  grid: Grid,
  piece: Piece,
  rotation: number,
  row: number,
  col: number,
): boolean {
  return fitsAt(grid, piece, rotation, row, col) && !fitsAt(grid, piece, rotation, row + 1, col);
}

/**
 * Lock a resting placement into the board (then clear any full rows) and return
 * a NEW grid; `grid` is not mutated. Throws if the placement does not fit. Use
 * {@link enumerateResting} to obtain legal placements; this is the generalized
 * counterpart of {@link applyPlacement} for tuck/spin positions and reproduces
 * it exactly for hard-drop placements.
 */
export function applyRestingPlacement(grid: Grid, piece: Piece, placement: RestingPlacement): Grid {
  const { rotation, row, col } = placement;
  if (!fitsAt(grid, piece, rotation, row, col)) {
    throw new Error(`illegal placement: ${piece} rot ${rotation} row ${row} col ${col}`);
  }
  const next = cloneBoard(grid);
  for (const [r, c] of pieceCells(piece, rotation, row, col)) {
    next[r][c] = 1;
  }
  return clearFullRows(next);
}

/** A packed integer key for a `(rotation, row, col)` BFS state. */
function stateKey(rotation: number, row: number, col: number): number {
  return (rotation * ROWS + row) * COLS + col;
}

/**
 * Every collision-reachable **floating state** `(rotation, row, col)` of `piece`
 * on `grid` — the full visited set of the maneuver BFS, not just the resting
 * ones.
 *
 * A BFS over the player's inputs — left, right, rotate (cw/ccw), and soft-drop
 * (down) — seeded from the spawn row (every rotation/column that fits at the top
 * of the board, where pieces enter). The free-positioning input (#43, #56) gates
 * its ghost on exactly this set, so the placements the player can manoeuvre into
 * and confirm match the generator's reachability model cell-for-cell (the
 * generator↔play parity invariant). {@link enumerateResting} is this set
 * narrowed to the states that cannot fall further.
 */
export function reachableStates(grid: Grid, piece: Piece): RestingPlacement[] {
  const rotations = ORIENTATIONS[piece].length;
  const seen = new Set<number>();
  const queue: RestingPlacement[] = [];

  const visit = (rotation: number, row: number, col: number): void => {
    if (!fitsAt(grid, piece, rotation, row, col)) return;
    const k = stateKey(rotation, row, col);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push({ rotation, row, col });
  };

  // Seed from the entry row: pieces appear at the top and are manoeuvred down.
  for (let rotation = 0; rotation < rotations; rotation++) {
    for (let col = 0; col < COLS; col++) {
      visit(rotation, 0, col);
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const { rotation, row, col } = queue[i];
    // Player moves: translate, rotate, soft-drop. `visit` enqueues legal states.
    visit(rotation, row, col - 1);
    visit(rotation, row, col + 1);
    visit(rotation, row + 1, col);
    if (rotations > 1) {
      const cw = normRotation(piece, rotation + 1);
      const ccw = normRotation(piece, rotation - 1);
      // NES rotation: piece rotates inside a fixed bounding box, so the
      // tight-bbox position shifts by the rotation offset.
      const [cwDr, cwDc] = rotationDelta(piece, rotation, cw);
      const [ccwDr, ccwDc] = rotationDelta(piece, rotation, ccw);
      visit(cw, row + cwDr, col + cwDc);
      visit(ccw, row + ccwDr, col + ccwDc);
      // Also visit the same-position rotation (backwards compat superset).
      visit(cw, row, col);
      visit(ccw, row, col);
    }
  }
  return queue;
}

/**
 * The floating state that selecting `targetCol` moves `piece` to from
 * `(rotation, row)` under the **tuck-seeking lateral** rule (#76, refining the
 * #68/#69 free-lateral rule):
 *
 * - Move to the **reachable** position in the target column **nearest the
 *   current row, preferring at-or-below** — i.e. tuck *into* a pocket rather than
 *   eject to the column top.
 * - **Ride up** (pick the nearest reachable position *above* the current row)
 *   only when nothing at-or-below is reachable.
 *
 * The candidates are taken from {@link reachableStates}, so every returned state
 * is one the generator enumerated — the superset/soundness binding invariant
 * holds. This replaces the old "fits at the current row, else ride up to the very
 * top" rule, whose ride-up ejected a piece to the column top whenever it did not
 * fit at the *exact* current row, making right-side tucks (puzzle 1374's col-4 /
 * col-8 holes) demand pixel-perfect soft-dropping.
 *
 * Returns `null` only when the move is genuinely blocked: no reachable state of
 * `piece` exists in the target column at this rotation (the column is full to the
 * very top, or the target would carry the piece off-screen). Shared by
 * keyboard/button lateral steps ({@link lateralMove}) and mobile drag (#69), so
 * both express identical tuck-seeking behaviour.
 *
 * `reachable` defaults to {@link reachableStates}`(grid, piece)`; callers that
 * already hold the reachable set (the play input, or a hot loop) pass it in to
 * skip recomputing the BFS per press.
 */
export function moveToColumn(
  grid: Grid,
  piece: Piece,
  rotation: number,
  row: number,
  targetCol: number,
  reachable: readonly RestingPlacement[] = reachableStates(grid, piece),
): RestingPlacement | null {
  return nearestReachableState(reachable, rotation, targetCol, row);
}

/**
 * Pick from `reachable` the state at `(targetRotation, targetCol)` **nearest the
 * current `row`, preferring at-or-below** (tuck/settle in), riding up only when
 * nothing at-or-below is reachable. The shared selection law behind both the
 * tuck-seeking lateral ({@link moveToColumn}, column-varying) and the
 * column-fixed {@link spin} (rotation-varying) — the rotational twin of the
 * lateral rule (#88). Returns `null` when no reachable state exists at that
 * rotation/column.
 */
function nearestReachableState(
  reachable: readonly RestingPlacement[],
  targetRotation: number,
  targetCol: number,
  row: number,
): RestingPlacement | null {
  let atOrBelow: RestingPlacement | null = null; // nearest reachable with row >= current (tuck in)
  let above: RestingPlacement | null = null; //     nearest reachable with row <  current (ride up)
  for (const s of reachable) {
    if (s.rotation !== targetRotation || s.col !== targetCol) continue;
    if (s.row >= row) {
      if (atOrBelow === null || s.row < atOrBelow.row) atOrBelow = s;
    } else if (above === null || s.row > above.row) {
      above = s;
    }
  }
  return atOrBelow ?? above;
}

/**
 * Rotate `piece` by `dir` (`'cw'` / `'ccw'`), applying the NES rotation
 * offset ({@link rotationDelta}) so the piece spins inside its fixed NES
 * bounding box. Snaps to the {@link reachableStates} candidate at the new
 * rotation and offset-adjusted column nearest the current `row` — preferring
 * at-or-below, riding **up** only when forced.
 *
 * NES Tetris has no SRS / wall-or-floor kicks — every real spin works by
 * rotating at a height where the rotated shape already fits, then settling.
 * Because candidates come from {@link reachableStates}, every returned state is
 * one the generator enumerated (the superset/soundness invariant).
 *
 * Returns `null` when `piece` has ≤1 orientation, or no reachable state exists
 * at the new rotation in the target column.
 *
 * `reachable` defaults to {@link reachableStates}`(grid, piece)`; callers that
 * already hold the set pass it in to skip recomputing the BFS per press.
 */
export function spin(
  grid: Grid,
  piece: Piece,
  rotation: number,
  row: number,
  col: number,
  dir: 'cw' | 'ccw',
  reachable: readonly RestingPlacement[] = reachableStates(grid, piece),
): RestingPlacement | null {
  const rotations = ORIENTATIONS[piece].length;
  if (rotations <= 1) return null;
  const next = normRotation(piece, rotation + (dir === 'cw' ? 1 : -1));
  const [dr, dc] = rotationDelta(piece, rotation, next);
  return nearestReachableState(reachable, next, col + dc, row + dr);
}

/**
 * The tuck-seeking lateral move (#76, #68) for a single L/R press in direction
 * `dir` (`-1` left, `+1` right): {@link moveToColumn} applied to the adjacent
 * column. `reachable` is forwarded so a caller can reuse one BFS across presses.
 */
export function lateralMove(
  grid: Grid,
  piece: Piece,
  rotation: number,
  row: number,
  col: number,
  dir: -1 | 1,
  reachable?: readonly RestingPlacement[],
): RestingPlacement | null {
  return moveToColumn(grid, piece, rotation, row, col + dir, reachable);
}

/**
 * Every collision-reachable **resting** placement of `piece` on `grid`: the
 * {@link reachableStates} that cannot fall one row further (the lock condition).
 * The result is a superset of every placement free-positioning input can reach
 * (the binding invariant), so it includes plain hard drops as well as tucks and
 * spins.
 */
export function enumerateResting(grid: Grid, piece: Piece): RestingPlacement[] {
  return reachableStates(grid, piece).filter(
    ({ rotation, row, col }) => !fitsAt(grid, piece, rotation, row + 1, col),
  );
}

/**
 * The canonical **outcome key** for a (resulting) board: its locked-cell set as
 * the 200-char binary string ({@link encodeBoard}). Matching by this key is
 * path- and rotation-numbering-independent — two placements (or encodings) that
 * land exactly the same cells share a key and so grade identically (#42).
 */
export function boardKey(grid: Grid): string {
  return encodeBoard(grid);
}

/** The reachable resting rows of `piece` at `(rotation, col)` on `grid`. */
function restingRowsAt(grid: Grid, piece: Piece, rotation: number, col: number): number[] {
  return enumerateResting(grid, piece)
    .filter((p) => p.rotation === rotation && p.col === col)
    .map((p) => p.row);
}

/**
 * Recover the exact resting **rows** of a stored two-ply {@link Line} by matching
 * the canonical outcome `targetKey` (#42).
 *
 * Legacy puzzles (and the generator before tucks were persisted with a row) store
 * each optimal placement as `{ rotation, col }` only — the resting row was dropped
 * at generation time. By geometry alone a **tuck** (slid under an overhang) is then
 * indistinguishable from a plain hard drop down the same column, so the replay
 * hard-drops it and animates the piece onto the ledge instead of into the pocket.
 *
 * The stored `boardKey`, however, encodes the *true* two-ply outcome. This searches
 * the (few) reachable resting rows of each ply that, applied in order, reproduce
 * `targetKey`, and returns the line with both rows pinned — so {@link restingCells}
 * lands the piece exactly where the puzzle actually says, tuck or not.
 *
 * Returns the line **unchanged** when it cannot improve on it: no `targetKey` is
 * given, the rows are already pinned, or no row combination reproduces the key
 * (then the caller's existing hard-drop fallback applies).
 */
export function resolveLineByOutcome(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  line: Line,
  targetKey?: string,
): Line {
  const [p1, p2] = line;
  // Nothing to recover: no outcome to match, or the rows are already pinned.
  if (targetKey === undefined || (p1.row !== undefined && p2.row !== undefined)) return line;

  const rows1 = p1.row !== undefined ? [p1.row] : restingRowsAt(board0, piece1, p1.rotation, p1.col);
  for (const r1 of rows1) {
    if (!fitsAt(board0, piece1, p1.rotation, r1, p1.col)) continue;
    const board1 = applyRestingPlacement(board0, piece1, {
      rotation: p1.rotation,
      row: r1,
      col: p1.col,
    });
    const rows2 = p2.row !== undefined ? [p2.row] : restingRowsAt(board1, piece2, p2.rotation, p2.col);
    for (const r2 of rows2) {
      if (!fitsAt(board1, piece2, p2.rotation, r2, p2.col)) continue;
      const board2 = applyRestingPlacement(board1, piece2, {
        rotation: p2.rotation,
        row: r2,
        col: p2.col,
      });
      if (boardKey(board2) === targetKey) {
        return [
          { ...p1, row: r1 },
          { ...p2, row: r2 },
        ];
      }
    }
  }
  return line;
}
