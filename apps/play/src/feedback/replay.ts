/**
 * Replay timeline (#25) — turns the stored optimal two-ply line into a sequence
 * of keyframes the {@link Feedback} view animates: each piece spawns at the top,
 * slides into its target column during the upper part of the fall, then drops
 * straight to rest and locks into the static stack; a line clear adds a flash
 * frame and a collapse frame.
 *
 * Pure (no DOM): the geometry is expressed as CSS `transform` strings the view
 * applies to a board-sized overlay, so the motion is a single GPU transform.
 */

import {
  COLS,
  ROWS,
  PIECE_GROUP,
  applyPlacement,
  applyPlacementColored,
  cloneColorGrid,
  fitsAt,
  restingCells,
  type ColorGrid,
  type Grid,
  type Line,
  type Piece,
} from '@trainer/core';
import type { Cell } from '../board/Board.js';

/** The falling-piece overlay for one keyframe. */
export interface ReplayOverlay {
  /** The piece's resting cells (their final board positions). */
  cells: readonly Cell[];
  piece: Piece;
  /** A CSS transform translating the overlay from spawn toward rest. */
  transform: string;
}

/** One frame of the replay. */
export interface Keyframe {
  /** The static stack drawn behind the overlay. */
  grid: Grid;
  /**
   * The colour grid parallel to {@link grid} (#31), present only when a base
   * colour grid was supplied to {@link buildReplay}. Each dropped piece is
   * painted its own NES colour group and the colours track line-clear
   * collapses, so the stack keeps its authentic colours through the whole
   * replay instead of reverting to white.
   */
  colorGrid?: ColorGrid;
  /** The falling piece, if this frame animates one. */
  overlay?: ReplayOverlay;
  /** Stable identity for the overlay across a piece's frames (React key). */
  overlayKey?: number;
  /** Rows flashing before they collapse, if this frame is a line clear. */
  flashRows?: readonly number[];
  /** A short caption for the progress line. */
  label: string;
}

/** The column the piece visually spawns over (NES top-centre). */
const SPAWN_COL = 3;

/** The spawn / mid-slide / rest transforms for a straight (hard-drop) descent. */
function transforms(cells: readonly Cell[]): { spawn: string; align: string; rest: string } {
  const top = Math.min(...cells.map(([r]) => r));
  const left = Math.min(...cells.map(([, c]) => c));
  const dxPct = (SPAWN_COL - left) * (100 / COLS);
  const upPct = top * (100 / ROWS);
  return {
    // Spawn: shifted to the spawn column and lifted to the top of the well.
    spawn: `translate(${dxPct}%, ${-upPct}%)`,
    // Mid-fall: column-aligned but still descending (the "slide" is now done).
    align: `translate(0%, ${-(upPct * 0.55)}%)`,
    // Rest: identity — the cells already sit at their final positions.
    rest: 'translate(0%, 0%)',
  };
}

/**
 * A horizontal offset (in columns) for an open chute the piece can fall down
 * and then slide out of into its resting cells WITHOUT passing through the
 * stack — used to route a tuck around the overhang it rests under. Returns `0`
 * when the piece simply drops straight in (the common, non-tuck case): a hard
 * drop always has a clear chute above its column, so this is `0` for it.
 *
 * Searches offsets nearest-first; an offset works when (a) the piece has a
 * clear vertical chute from the top down to its rest row in the shifted column
 * and (b) it can slide horizontally from there into the rest column at the rest
 * row without hitting a filled cell.
 */
function tuckOffset(
  grid: Grid,
  piece: Piece,
  rotation: number,
  restTop: number,
  restLeft: number,
): number {
  const order = [0];
  for (let d = 1; d < COLS; d++) order.push(-d, d);
  for (const h of order) {
    const chuteCol = restLeft + h;
    if (chuteCol < 0 || chuteCol >= COLS) continue;
    let clear = true;
    for (let r = 0; r <= restTop && clear; r++) {
      if (!fitsAt(grid, piece, rotation, r, chuteCol)) clear = false;
    }
    if (!clear) continue;
    // Slide horizontally at the rest row from the chute column into place.
    const step = h > 0 ? -1 : 1;
    for (let c = chuteCol; c !== restLeft && clear; c += step) {
      if (!fitsAt(grid, piece, rotation, restTop, c)) clear = false;
    }
    if (clear && fitsAt(grid, piece, rotation, restTop, restLeft)) return h;
  }
  return 0;
}

/**
 * The ordered overlay transforms that animate `rest` from spawn to its settled
 * position on `grid`. A straight drop uses the spawn → align → rest slide; a
 * tuck (no clear straight chute) instead falls down an open chute then slides
 * sideways under the overhang, so it never clips through the stack.
 */
function replayPath(grid: Grid, piece: Piece, rotation: number, rest: readonly Cell[]): string[] {
  const restTop = Math.min(...rest.map(([r]) => r));
  const restLeft = Math.min(...rest.map(([, c]) => c));
  const h = tuckOffset(grid, piece, rotation, restTop, restLeft);
  if (h === 0) {
    const t = transforms(rest);
    return [t.spawn, t.align, t.rest];
  }
  const dxPct = h * (100 / COLS);
  const upPct = restTop * (100 / ROWS);
  return [
    // Spawn over the open chute, lifted to the top of the well.
    `translate(${dxPct}%, ${-upPct}%)`,
    // Fall straight down the chute to the rest row (still offset sideways).
    `translate(${dxPct}%, 0%)`,
    // Slide sideways under the overhang into the resting cells.
    'translate(0%, 0%)',
  ];
}

/** The indices of fully-filled rows in `grid` (the rows a clear will remove). */
function fullRows(grid: Grid): number[] {
  const rows: number[] = [];
  grid.forEach((row, r) => {
    if (row.every((cell) => cell)) rows.push(r);
  });
  return rows;
}

/**
 * Build the replay keyframes for `line` starting from `board0`. The last frame
 * is always the settled board (also used as the reduced-motion snapshot).
 *
 * When `baseColors` is supplied (the puzzle's stored colour grid, #31), every
 * keyframe carries a parallel colour grid: the base stack keeps its colours and
 * each dropped piece is painted its own NES colour group, tracked through any
 * line-clear collapse — so the replay never reverts to white. Without it the
 * keyframes omit `colorGrid` and the renderer falls back to the white group.
 *
 * Generic over the placements: pass any `(piece1, piece2)` line, not only the
 * stored optimal one (the ranked-combo list, #35, replays arbitrary combos).
 */
export function buildReplay(
  board0: Grid,
  piece1: Piece,
  piece2: Piece,
  line: Line,
  baseColors?: ColorGrid,
): Keyframe[] {
  const plies = [
    { piece: piece1, placement: line[0] },
    { piece: piece2, placement: line[1] },
  ];
  const keyframes: Keyframe[] = [];
  let current = board0;
  let currentColors = baseColors ? cloneColorGrid(baseColors) : undefined;

  plies.forEach(({ piece, placement }, i) => {
    const rest = restingCells(current, piece, placement);
    if (!rest) {
      // The placement cannot legally rest (e.g. an off-board combo selected from
      // the ranked list); it also cannot be applied, so skip it entirely and
      // leave the board unchanged rather than throwing.
      return;
    }
    const group = PIECE_GROUP[piece];
    const preClear = current.map((row) => row.slice());
    for (const [r, c] of rest) preClear[r][c] = 1;
    // Colours before the clear: the piece's cells painted onto the live stack.
    const preClearColors = currentColors ? cloneColorGrid(currentColors) : undefined;
    if (preClearColors) for (const [r, c] of rest) preClearColors[r][c] = group;
    const post = applyPlacement(current, piece, placement);
    const postColors = currentColors
      ? applyPlacementColored(current, currentColors, piece, placement, group).colors
      : undefined;
    const cleared = fullRows(preClear);
    const path = replayPath(current, piece, placement.rotation, rest);
    const label = `Piece ${i + 1} of 2`;

    for (const transform of path) {
      keyframes.push({
        grid: current,
        colorGrid: currentColors,
        overlay: { cells: rest, piece, transform },
        overlayKey: i,
        label,
      });
    }

    // Hold the piece visibly AT its resting spot for one beat before it locks
    // (#81): the final move of a tuck is a quick sideways slide into the pocket;
    // without this beat it vanishes into the static stack the instant it arrives,
    // so the slide reads as "sits to the side and never moves into place". The
    // extra frame repeats the rest transform, so it does not animate — it simply
    // lets the arrival register before the overlay unmounts.
    keyframes.push({
      grid: current,
      colorGrid: currentColors,
      overlay: { cells: rest, piece, transform: path[path.length - 1] },
      overlayKey: i,
      label,
    });

    if (cleared.length) {
      keyframes.push({
        grid: preClear,
        colorGrid: preClearColors,
        flashRows: cleared,
        label: 'Line clear!',
      });
      keyframes.push({ grid: post, colorGrid: postColors, label });
    } else {
      // No clear: the locked board equals `post`; one settle frame.
      keyframes.push({ grid: post, colorGrid: postColors, label });
    }
    current = post;
    currentColors = postColors;
  });

  keyframes.push({ grid: current, colorGrid: currentColors, label: 'Optimal line' });
  return keyframes;
}
