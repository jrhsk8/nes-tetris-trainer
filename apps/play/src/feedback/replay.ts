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

/** The spawn / mid-slide / rest transforms for a piece resting at `cells`. */
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
    const t = transforms(rest);
    const label = `Piece ${i + 1} of 2`;

    keyframes.push({
      grid: current,
      colorGrid: currentColors,
      overlay: { cells: rest, piece, transform: t.spawn },
      overlayKey: i,
      label,
    });
    keyframes.push({
      grid: current,
      colorGrid: currentColors,
      overlay: { cells: rest, piece, transform: t.align },
      overlayKey: i,
      label,
    });
    keyframes.push({
      grid: current,
      colorGrid: currentColors,
      overlay: { cells: rest, piece, transform: t.rest },
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
