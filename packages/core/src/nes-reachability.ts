/**
 * NES 19+ reachability — a movement model that captures the *timing* of real NES
 * play at level 19, used to tell a **spintuck** apart from a plain tuck (see
 * {@link isSpintuck} in maneuver.ts).
 *
 * The owner's definition: a spintuck is a placement you can only reach at 19+
 * speed by rotating the piece into its cells **at the last second** — you cannot
 * drop it in pre-rotated (the cells are under an overhang) and you cannot slide
 * it under the lip in the frames available before it locks. "The spin comes last
 * second."
 *
 * Rather than simulate every frame, this models the *binding constraint* of
 * level-19 + DAS-only play:
 *
 *  - **Above the stack the piece moves freely.** While a position is in "free
 *    space" (the piece can be lifted straight up out of the board), the player
 *    has time to charge DAS and slide to any approach column. Lateral moves whose
 *    *destination* is free space cost nothing.
 *  - **Under a lip you get ONE shift.** A lateral move whose destination is
 *    *covered* (a filled cell somewhere above it) is the single immediate DAS
 *    press you can land before the piece locks. At level 19 the lock window is
 *    ~1 frame and DAS-only cannot deliver a second shift in time (hypertapping is
 *    excluded), so a path may spend that budget at most once. Anything needing
 *    two+ shifts under cover is unreachable without the spin trick.
 *  - **Gravity** is a straight-down soft-drop between shifts (free).
 *  - **Rotation** (when allowed) is fast — not DAS-limited — so it may happen any
 *    time, including at depth (the "trick"). NES rotation is in place (no kicks).
 *
 * Two queries fall out, both over the same BFS:
 *  - {@link slideReachableAtSpeed}: reach the placement **pre-rotated**, no
 *    rotation during the fall. If true, it's a plain tuck (you slid it in).
 *  - {@link spinReachableAtSpeed}: reach it allowing a rotation at depth. If true,
 *    the last-second spin works.
 *
 * A spintuck is then: an idealized tuck that is NOT slide-reachable at speed but
 * IS spin-reachable at speed.
 *
 * This is a deliberate reduction of the full frame timing to its binding case
 * (one under-cover shift before lock at level 19). It is exact for the shallow
 * tuck slots puzzles use; it does not credit the rare deep DAS re-shift (a second
 * shift after ~8 rows of further fall), erring toward the stricter DAS-only read.
 */

import { ROWS, COLS, type Grid } from './board.js';
import { ORIENTATIONS, type Piece } from './pieces.js';
import { fitsAt, pieceCells, rotationDelta, type RestingPlacement } from './placement.js';

/** Is the piece at `(rotation,row,col)` liftable straight up out of the board? */
function inFreeSpace(grid: Grid, piece: Piece, rotation: number, row: number, col: number): boolean {
  for (const [r, c] of pieceCells(piece, rotation, row, col)) {
    for (let rr = r - 1; rr >= 0; rr--) if (grid[rr][c]) return false;
  }
  return true;
}

/** Pack a BFS state into a single integer key. */
function key(rotation: number, row: number, col: number, usedLipShift: number): number {
  return ((rotation * ROWS + row) * COLS + (col + 2)) * 2 + usedLipShift; // +2: col can BFS to -1/-2 transiently? no — guarded by fitsAt
}

interface SpeedOptions {
  /** Allow rotation during the fall (the spin trick). When false, the piece is
   *  pre-rotated to the target rotation and never rotates again. */
  allowSpin: boolean;
}

/**
 * Can the piece reach `target` (a resting placement) under the level-19 DAS-only
 * model? With `allowSpin: false` the piece is pre-rotated to `target.rotation`
 * and may not rotate (a pure slide/tuck); with `allowSpin: true` it may rotate
 * freely at any depth (the last-second spin).
 */
function reachableAtSpeed(
  grid: Grid,
  piece: Piece,
  target: RestingPlacement,
  opts: SpeedOptions,
): boolean {
  const nRot = ORIENTATIONS[piece].length;
  const startRots = opts.allowSpin
    ? Array.from({ length: nRot }, (_, r) => r)
    : [((target.rotation % nRot) + nRot) % nRot];

  const seen = new Set<number>();
  type Node = { rotation: number; row: number; col: number; used: number };
  const q: Node[] = [];
  const seed = (rotation: number, row: number, col: number, used: number): void => {
    if (!fitsAt(grid, piece, rotation, row, col)) return;
    const k = key(rotation, row, col, used);
    if (seen.has(k)) return;
    seen.add(k);
    q.push({ rotation, row, col, used });
  };

  // Seed: the piece enters from the very top in each allowed rotation, in every
  // column where it fits at row 0. Free lateral at the top then spreads it across.
  for (const rot of startRots) for (let c = 0; c < COLS; c++) seed(rot, 0, c, 0);

  const targetRot = ((target.rotation % nRot) + nRot) % nRot;
  for (let i = 0; i < q.length; i++) {
    const { rotation, row, col, used } = q[i];

    // Success: at the target cell, in the target rotation, and resting (locked).
    if (
      rotation === targetRot &&
      row === target.row &&
      col === target.col &&
      !fitsAt(grid, piece, rotation, row + 1, col)
    ) {
      return true;
    }

    // Soft-drop (gravity) — free.
    seed(rotation, row + 1, col, used);

    // Lateral. A move whose destination is free space is free (positioning above
    // the stack); a move whose destination is covered spends the one lip-shift.
    for (const d of [-1, 1] as const) {
      const nc = col + d;
      if (!fitsAt(grid, piece, rotation, row, nc)) continue;
      if (inFreeSpace(grid, piece, rotation, row, nc)) {
        seed(rotation, row, nc, used);
      } else if (used === 0) {
        seed(rotation, row, nc, 1);
      }
    }

    // Rotation (the trick) — fast (a single button press, not DAS-limited), so it
    // may happen at any depth when permitted. NES rotates inside a fixed bounding
    // box, so the tight-bbox origin shifts by the rotation offset (this sideways
    // shift is part of the rotate, hence free); we also visit the same-position
    // rotation as a superset, matching reachableStates().
    if (opts.allowSpin && nRot > 1) {
      for (const d of [1, nRot - 1]) {
        const nrot = (rotation + d) % nRot;
        const [dr, dc] = rotationDelta(piece, rotation, nrot);
        seed(nrot, row + dr, col + dc, used);
        seed(nrot, row, col, used);
      }
    }
  }
  return false;
}

/**
 * True if `placement` can be reached at level-19 speed **pre-rotated** (a plain
 * slide/tuck, no rotation during the fall). If this is false but the piece could
 * still be rotated into place, the placement needs the spin trick.
 */
export function slideReachableAtSpeed(grid: Grid, piece: Piece, placement: RestingPlacement): boolean {
  return reachableAtSpeed(grid, piece, placement, { allowSpin: false });
}

/**
 * True if `placement` can be reached at level-19 speed **allowing a rotation at
 * depth** (the last-second spin). For a piece that cannot rotate (O) this equals
 * {@link slideReachableAtSpeed}.
 */
export function spinReachableAtSpeed(grid: Grid, piece: Piece, placement: RestingPlacement): boolean {
  return reachableAtSpeed(grid, piece, placement, { allowSpin: true });
}
