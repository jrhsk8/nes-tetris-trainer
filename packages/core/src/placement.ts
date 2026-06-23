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
} from './board.js';
import { ORIENTATIONS, type Piece } from './pieces.js';

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
      visit(normRotation(piece, rotation + 1), row, col);
      visit(normRotation(piece, rotation - 1), row, col);
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
  let atOrBelow: RestingPlacement | null = null; // nearest reachable with row >= current (tuck in)
  let above: RestingPlacement | null = null; //     nearest reachable with row <  current (ride up)
  for (const s of reachable) {
    if (s.rotation !== rotation || s.col !== targetCol) continue;
    if (s.row >= row) {
      if (atOrBelow === null || s.row < atOrBelow.row) atOrBelow = s;
    } else if (above === null || s.row > above.row) {
      above = s;
    }
  }
  return atOrBelow ?? above;
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
