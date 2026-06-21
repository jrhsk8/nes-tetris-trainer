/**
 * Board model — pure functions over a Tetris board grid. No engine, network,
 * or DOM dependency. Used both offline (the generator, to store the optimal
 * result and its metrics) and in the client (to compute the player's
 * result-board metrics without an engine round-trip). Issue #3.
 */

import type { ColorGroup, Piece } from './pieces.js';
import { ORIENTATIONS } from './pieces.js';

/** Number of rows on an NES Tetris board. */
export const ROWS = 20;
/** Number of columns on an NES Tetris board. */
export const COLS = 10;

/**
 * A board grid: `ROWS` rows of `COLS` cells, `grid[row][col]`. Row 0 is the
 * TOP of the playfield and row 19 is the floor — this matches StackRabbit's
 * `parseBoard`, where the 200-char string is read row-major from the top.
 * A cell is `0` (empty) or `1` (filled).
 */
export type Grid = number[][];

/** A resting placement: a piece rotation and the board column of its left edge. */
export interface Placement {
  /** Rotation index into the piece's orientation table (see `ORIENTATIONS`). */
  rotation: number;
  /** Board column of the placed piece's left-most cell (0 = leftmost column). */
  col: number;
  /**
   * Optional exact resting row (the bounding box's top). When set it pins a
   * tuck/spin position free-positioning input (#43) produced — the piece rests
   * exactly here rather than being hard-dropped down the column. When omitted
   * the placement is a plain hard drop: the piece falls straight to rest.
   */
  row?: number;
}

/**
 * An ordered two-placement line: the first placement, then the second. Both the
 * player's attempt and a stored two-piece combo take this shape.
 */
export type Line = readonly [Placement, Placement];

/** An empty `ROWS`×`COLS` grid. */
export function emptyBoard(): Grid {
  return Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
}

/** A deep copy of `grid`. */
export function cloneBoard(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/**
 * Decode a 200-char board string into a grid. The string is read row-major
 * from the top: index `row * COLS + col`. `'0'` is empty; any other character
 * is treated as filled. This is StackRabbit's confirmed orientation (see the
 * module note on `Grid`).
 */
export function decodeBoard(encoded: string): Grid {
  if (encoded.length !== ROWS * COLS) {
    throw new Error(`board string must be ${ROWS * COLS} chars, got ${encoded.length}`);
  }
  const grid = emptyBoard();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      grid[row][col] = encoded[row * COLS + col] === '0' ? 0 : 1;
    }
  }
  return grid;
}

/**
 * Encode a grid into the 200-char board string (`'0'` empty, `'1'` filled),
 * the exact inverse of `decodeBoard` for binary grids.
 */
export function encodeBoard(grid: Grid): string {
  let out = '';
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      out += grid[row][col] ? '1' : '0';
    }
  }
  return out;
}

/** True if `(row, col)` is on the board. */
function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

/** The board cells a piece occupies if its left edge sits at `col`, dropped by `drop` rows. */
function placedCells(
  piece: Piece,
  rotation: number,
  col: number,
  drop: number,
): Array<[number, number]> {
  const orientations = ORIENTATIONS[piece];
  const cells = orientations[rotation % orientations.length];
  return cells.map(([r, c]) => [r + drop, c + col] as [number, number]);
}

/** True if every cell of the placement is on the board and lands on an empty square. */
function fits(grid: Grid, piece: Piece, rotation: number, col: number, drop: number): boolean {
  for (const [r, c] of placedCells(piece, rotation, col, drop)) {
    if (!inBounds(r, c) || grid[r][c]) return false;
  }
  return true;
}

/**
 * The board cells `piece` (in `placement.rotation`, left edge at `placement.col`)
 * would occupy after dropping straight down until it rests on the stack or floor.
 * Returns the resting cells as `[row, col]` pairs, or `null` if the placement
 * cannot legally sit on the board (column off the edge, or no room to enter).
 *
 * This is the geometry the ghost-piece UI overlays before a placement is locked
 * (#10) and the optimal line animates (#12); `applyPlacement` shares it.
 */
export function restingCells(
  grid: Grid,
  piece: Piece,
  placement: Placement,
): Array<[number, number]> | null {
  const { rotation, col, row } = placement;

  // A pinned resting row (a tuck/spin, #43): the cells exactly there, if they
  // legally fit. No straight drop — the position was reached by manoeuvring.
  if (row !== undefined) {
    if (!fits(grid, piece, rotation, col, row)) return null;
    return placedCells(piece, rotation, col, row);
  }

  // The resting drop is the largest `drop` for which the piece still fits.
  let resting = -1;
  for (let drop = 0; drop <= ROWS; drop++) {
    if (fits(grid, piece, rotation, col, drop)) resting = drop;
    else if (resting >= 0) break; // first collision after a valid rest: stop.
  }
  if (resting < 0) return null;
  return placedCells(piece, rotation, col, resting);
}

/**
 * Apply a placement: drop `piece` (in `placement.rotation`) into `placement.col`
 * until it rests on the stack or floor, lock it, then clear any full rows. Returns
 * a NEW grid; `grid` is not mutated. Throws if the placement cannot legally sit on
 * the board (column off the edge, or no room to enter).
 */
export function applyPlacement(grid: Grid, piece: Piece, placement: Placement): Grid {
  const cells = restingCells(grid, piece, placement);
  if (!cells) {
    throw new Error(`illegal placement: ${piece} rot ${placement.rotation} col ${placement.col}`);
  }

  const next = cloneBoard(grid);
  for (const [r, c] of cells) {
    next[r][c] = 1;
  }
  return clearFullRows(next);
}

/** Remove every fully-filled row and drop the rows above down to refill the top. */
export function clearFullRows(grid: Grid): Grid {
  const kept = grid.filter((row) => row.some((cell) => !cell));
  const cleared = ROWS - kept.length;
  const top = Array.from({ length: cleared }, () => new Array<number>(COLS).fill(0));
  return top.concat(kept);
}

/**
 * A parallel colour grid: `grid[row][col]` is `0` (empty) or a {@link ColorGroup}
 * (`1`..`3`). It mirrors the binary {@link Grid} cell-for-cell — the same cells
 * are filled — but records which NES colour group filled each cell (#28). The
 * binary grid stays colour-blind; metrics, checker, and placement never read
 * this. Only the offline generator (to store a puzzle's colours) and the play
 * app's renderer use it.
 */
export type ColorGrid = number[][];

/** An empty `ROWS`×`COLS` colour grid (all cells `0`). */
export function emptyColorGrid(): ColorGrid {
  return Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
}

/** A deep copy of `grid`. */
export function cloneColorGrid(grid: ColorGrid): ColorGrid {
  return grid.map((row) => row.slice());
}

/**
 * Encode a colour grid into the 200-char string the puzzle bank stores: `'0'`
 * empty, `'1'`/`'2'`/`'3'` the NES colour group. Row-major from the top, the
 * same orientation as {@link encodeBoard}.
 */
export function encodeColors(grid: ColorGrid): string {
  let out = '';
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      out += String(grid[row][col] || 0);
    }
  }
  return out;
}

/**
 * Decode a 200-char colour string into a colour grid (the inverse of
 * {@link encodeColors}). `'0'` is empty; `'1'`/`'2'`/`'3'` are colour groups.
 */
export function decodeColors(encoded: string): ColorGrid {
  if (encoded.length !== ROWS * COLS) {
    throw new Error(`colour string must be ${ROWS * COLS} chars, got ${encoded.length}`);
  }
  const grid = emptyColorGrid();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      grid[row][col] = Number(encoded[row * COLS + col]) || 0;
    }
  }
  return grid;
}

/**
 * Apply a placement to a board AND its parallel colour grid in lock-step:
 * drop `piece` into `placement.col`, lock it (filling the new cells with
 * `group` in the colour grid), then clear any full rows from BOTH grids
 * identically. Returns NEW grids; the inputs are not mutated. Throws on an
 * illegal placement, exactly like {@link applyPlacement} — and the returned
 * `board` is identical to `applyPlacement(board, piece, placement)`, so the
 * colour grid never diverges from the binary one.
 */
export function applyPlacementColored(
  board: Grid,
  colors: ColorGrid,
  piece: Piece,
  placement: Placement,
  group: ColorGroup,
): { board: Grid; colors: ColorGrid } {
  const cells = restingCells(board, piece, placement);
  if (!cells) {
    throw new Error(`illegal placement: ${piece} rot ${placement.rotation} col ${placement.col}`);
  }

  const lockedBoard = cloneBoard(board);
  const lockedColors = cloneColorGrid(colors);
  for (const [r, c] of cells) {
    lockedBoard[r][c] = 1;
    lockedColors[r][c] = group;
  }

  // Clear full rows from both grids using the same kept-row mask, so the colour
  // grid tracks line clears exactly as the binary grid does.
  const nextBoard: Grid = [];
  const nextColors: ColorGrid = [];
  for (let row = 0; row < ROWS; row++) {
    if (lockedBoard[row].some((cell) => !cell)) {
      nextBoard.push(lockedBoard[row]);
      nextColors.push(lockedColors[row]);
    }
  }
  const cleared = ROWS - nextBoard.length;
  for (let i = 0; i < cleared; i++) {
    nextBoard.unshift(new Array<number>(COLS).fill(0));
    nextColors.unshift(new Array<number>(COLS).fill(0));
  }
  return { board: nextBoard, colors: nextColors };
}
