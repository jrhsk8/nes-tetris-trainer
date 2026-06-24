/**
 * Automatic puzzle **type-tags** (#81) — a pure, engine-free classifier that
 * labels a puzzle by what its **optimal (rank-1) line** does, so puzzles are
 * self-describing (display), filterable (drill mode), and trackable per-skill.
 *
 * A puzzle may carry several tags; **zero tags is allowed**. Every predicate is
 * computed on the rank-1 two-piece line, reconstructed from the stored combo
 * entry via {@link restingLineForEntry} (it decodes the entry's `boardKey`), so
 * no StackRabbit / network / DOM is touched. `start` = the puzzle board before
 * either placement, `after` = the board after BOTH placements (full rows
 * cleared, as in play).
 *
 * See PRD § type-tags and the grill of 2026-06-23 (Q2: tags reflect the optimal
 * line). The contrast tags (`avoid-<piece>-dependency`, #90) extend this module
 * and additionally read the full combo table.
 */

import { ROWS, COLS, type Grid } from './board.js';
import { ORIENTATIONS, type Piece } from './pieces.js';
import { fitsAt, enumerateResting, type RestingPlacement } from './placement.js';
import { holes } from './metrics.js';
import {
  restingLineForEntry,
  lockAndClear,
  lineClearsTetris,
  type ComboEntry,
} from './combo.js';

/**
 * The closed set of puzzle type-tags (#81). Each reflects a property of the
 * puzzle's optimal / rank-1 line.
 */
export type PuzzleTag =
  | 'burn'
  | 'tetris'
  | 'tetris-ready'
  | 'tuck'
  | 'spin'
  | 'clean-stacking'
  | 'dig'
  | 'well-maintenance';

/**
 * How much deeper than BOTH its neighbours a column must be to count as an open
 * **well** for the `well-maintenance` tag — a named, tunable constant (default
 * 3). `tetris-ready` uses a fixed depth of 4 (a clearing vertical I).
 */
export const WELL_DEPTH = 3;

/** Filled height of each column (0 = empty column). */
function columnHeights(grid: Grid): number[] {
  const heights = new Array<number>(COLS).fill(0);
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[row][col]) {
        heights[col] = ROWS - row;
        break;
      }
    }
  }
  return heights;
}

/**
 * The column indices that are open **wells**: at least {@link WELL_DEPTH} lower
 * than EVERY existing neighbour (edge columns have one neighbour). A single such
 * column is the well a `well-maintenance` puzzle keeps open.
 */
function wellColumns(grid: Grid, minDepth = WELL_DEPTH): number[] {
  const h = columnHeights(grid);
  const wells: number[] = [];
  for (let c = 0; c < COLS; c++) {
    const neighbours: number[] = [];
    if (c > 0) neighbours.push(h[c - 1]);
    if (c < COLS - 1) neighbours.push(h[c + 1]);
    if (neighbours.every((nh) => nh - h[c] >= minDepth)) wells.push(c);
  }
  return wells;
}

/** True if a vertical I-piece can clear 4 rows in SOME column of `grid`. */
function tetrisReady(grid: Grid): boolean {
  const vertical = ORIENTATIONS.I.length - 1; // the column orientation (index 1)
  return enumerateResting(grid, 'I')
    .filter((p) => p.rotation === vertical)
    .some((p) => lockAndClear(grid, 'I', p).cleared === 4);
}

/**
 * The lowest row a piece reaches by a pure straight-down drop in `col` at the
 * fixed `rotation` (entering from the top), or `null` when it cannot even enter
 * the column from the top. A resting placement whose row exceeds this is reached
 * only by manoeuvring (a tuck or a spin), never a hard drop.
 */
function hardDropRow(
  grid: Grid,
  piece: Piece,
  rotation: number,
  col: number,
): number | null {
  if (!fitsAt(grid, piece, rotation, 0, col)) return null;
  let row = 0;
  while (fitsAt(grid, piece, rotation, row + 1, col)) row++;
  return row;
}

/** Is `placement` reachable by simply choosing a column + rotation and hard-dropping? */
function isHardDrop(grid: Grid, piece: Piece, placement: RestingPlacement): boolean {
  return hardDropRow(grid, piece, placement.rotation, placement.col) === placement.row;
}

function transKey(row: number, col: number): number {
  return row * COLS + col;
}

/**
 * Is `(rotation, targetRow, targetCol)` reachable by a **translation-only** BFS —
 * down / left / right with the orientation held fixed, entering from the top?
 * This is the tuck/spin splitter (#81): a non-hard-drop placement that is
 * translation-reachable is a **tuck** (slid under an overhang); one that is NOT
 * is a **spin** (it needs a rotation at depth).
 */
function translationReachable(
  grid: Grid,
  piece: Piece,
  rotation: number,
  targetRow: number,
  targetCol: number,
): boolean {
  const seen = new Set<number>();
  const queue: Array<[number, number]> = [];
  const visit = (r: number, c: number): void => {
    if (!fitsAt(grid, piece, rotation, r, c)) return;
    const k = transKey(r, c);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push([r, c]);
  };
  for (let c = 0; c < COLS; c++) visit(0, c); // enter from the top
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    visit(r + 1, c); // soft-drop
    visit(r, c - 1); // left
    visit(r, c + 1); // right
  }
  return seen.has(transKey(targetRow, targetCol));
}

/** Whether a resting placement is a tuck, a spin, or a plain hard drop. */
function maneuver(
  grid: Grid,
  piece: Piece,
  placement: RestingPlacement,
): 'hard-drop' | 'tuck' | 'spin' {
  if (isHardDrop(grid, piece, placement)) return 'hard-drop';
  return translationReachable(grid, piece, placement.rotation, placement.row, placement.col)
    ? 'tuck'
    : 'spin';
}

/**
 * Tag a puzzle by its optimal / rank-1 line (#81). Reconstructs the rank-1
 * resting line from `rank1` (via {@link restingLineForEntry}, which uses the
 * entry's `boardKey`), replays it, and emits every matching {@link PuzzleTag}.
 * Returns `[]` when nothing matches — or when the line cannot be reconstructed
 * (a legacy entry with no recoverable rows), consistent with the re-tag path.
 */
export function tagPuzzle(
  board: Grid,
  piece1: Piece,
  piece2: Piece,
  rank1: ComboEntry,
): PuzzleTag[] {
  const line = restingLineForEntry(board, piece1, piece2, rank1);
  if (line === null) return [];
  const { p1, p2 } = line;

  // Replay, tracking lines cleared by each placement and the intermediate board
  // p2 actually rests on (post-clear), so tuck/spin sees the right surface.
  const start = board;
  const a = lockAndClear(start, piece1, p1);
  const board1 = a.board;
  const b = lockAndClear(board1, piece2, p2);
  const after = b.board;
  const linesCleared = a.cleared + b.cleared;
  const holesStart = holes(start);
  const holesAfter = holes(after);

  const tags = new Set<PuzzleTag>();

  // burn / tetris (mutually exclusive by construction).
  if (lineClearsTetris(start, piece1, piece2, p1, p2)) {
    tags.add('tetris');
  } else if (linesCleared >= 1 && linesCleared <= 3) {
    tags.add('burn');
  }

  // tetris-ready: not ready at start, ready after.
  if (!tetrisReady(start) && tetrisReady(after)) tags.add('tetris-ready');

  // tuck / spin: a non-hard-drop placement, split by translation-reachability.
  for (const m of [maneuver(start, piece1, p1), maneuver(board1, piece2, p2)]) {
    if (m === 'tuck') tags.add('tuck');
    else if (m === 'spin') tags.add('spin');
  }

  // clean-stacking: no clears and no new holes.
  if (linesCleared === 0 && holesAfter === holesStart) tags.add('clean-stacking');

  // dig: a line cleared AND holes reduced.
  if (linesCleared >= 1 && holesAfter < holesStart) tags.add('dig');

  // well-maintenance: a single open well at start, still open after.
  const wells = wellColumns(start);
  if (wells.length === 1 && wellColumns(after).includes(wells[0])) {
    tags.add('well-maintenance');
  }

  return [...tags];
}
