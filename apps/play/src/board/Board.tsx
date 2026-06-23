/**
 * Board renderer (#10, #18) — a presentational 20×10 NES playfield. Renders the
 * filled stack, plus optional ghost cells (the piece the player is positioning)
 * and optional highlight cells (used by the feedback view, #12). No input or
 * game logic lives here; it is a pure function of its props.
 *
 * Cells are drawn as pixel-accurate NES level-18 block sprites (see `nes.ts`),
 * crisp at any scale. The current/optimal piece is coloured by its real NES
 * colour group. The existing stack is coloured per-cell from the optional
 * `colorGrid` (#28) — the puzzle's stored colour grid; a filled cell with no
 * colour-grid group (legacy puzzles, or the colour-blind unit tests) falls back
 * to the white block group.
 */

import type { ReactNode } from 'react';
import { COLS, ROWS, type ColorGrid, type Grid, type Piece } from '@trainer/core';
import { PIECE_GROUP, blockBackground, type ColorGroup } from './nes.js';

/** A `[row, col]` cell coordinate. */
export type Cell = readonly [number, number];

export interface BoardProps {
  /** The board grid to render. */
  grid: Grid;
  /**
   * Optional colour grid parallel to `grid` (#28): the NES colour group that
   * fills each cell. Filled cells with a group of `1`/`2`/`3` draw that group's
   * sprite; `0` / out-of-range / absent falls back to the white group.
   */
  colorGrid?: ColorGrid;
  /** Cells of the drop-shadow: where the positioned piece would land. */
  ghostCells?: readonly Cell[];
  /**
   * Cells of the **active piece** the player is flying (#81): drawn as a solid,
   * bright sprite (a light inset edge sets it apart from a locked block), so
   * soft-dropping visibly carries it down and a tuck reads as a sideways step.
   */
  activeCells?: readonly Cell[];
  /** Colour the active piece as this piece (defaults to the white group). */
  activePiece?: Piece;
  /** Cells to draw as a highlight (e.g. the optimal placement in feedback). */
  highlightCells?: readonly Cell[];
  /** Colour the ghost cells as this piece (defaults to the white group). */
  ghostPiece?: Piece;
  /** Colour the highlight cells as this piece (defaults to the white group). */
  highlightPiece?: Piece;
  /**
   * An absolutely-positioned layer drawn over the grid, exactly covering the
   * cell area (the replay falling piece / line-clear flash, #25). It is the
   * caller's job to make its content `position: absolute; inset: 0`.
   */
  overlay?: ReactNode;
}

const keyOf = (r: number, c: number) => `${r}-${c}`;

/**
 * Defensive render guard (#58): drop any cell outside the 20×10 grid. The
 * reachability model already proves no piece can reach past a wall (see
 * `placement.test.ts`), so this never fires in practice — it is belt-and-
 * suspenders against any future data/logic anomaly, so the board can never draw
 * a block past the right wall (the reported symptom) regardless of input.
 */
const onBoard = (cells: readonly Cell[]): Cell[] =>
  cells.filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS);

const WHITE_GROUP: ColorGroup = 1;

export function Board({
  grid,
  colorGrid,
  ghostCells = [],
  activeCells = [],
  activePiece,
  highlightCells = [],
  ghostPiece,
  highlightPiece,
  overlay,
}: BoardProps) {
  const ghost = new Set(onBoard(ghostCells).map(([r, c]) => keyOf(r, c)));
  const active = new Set(onBoard(activeCells).map(([r, c]) => keyOf(r, c)));
  const highlight = new Set(onBoard(highlightCells).map(([r, c]) => keyOf(r, c)));
  const ghostGroup = ghostPiece ? PIECE_GROUP[ghostPiece] : WHITE_GROUP;
  const activeGroup = activePiece ? PIECE_GROUP[activePiece] : WHITE_GROUP;
  const highlightGroup = highlightPiece ? PIECE_GROUP[highlightPiece] : WHITE_GROUP;

  return (
    <div
      className="board-well"
      style={{
        display: 'inline-block',
        padding: 6,
        background: '#000',
        border: '4px solid #bcbcbc',
        boxShadow: '0 0 0 2px #000, 0 0 0 6px #6b6b6b',
        lineHeight: 0,
      }}
    >
      <div
        role="grid"
        aria-label="board"
        className="board"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gap: 0,
          // Sized as the centred hero in styles.css (#22): scales with the
          // viewport height, no fixed pixel cap. Falls back to a sane width if
          // the stylesheet is absent (e.g. unit tests).
          width: 'var(--board-width, min(86vw, 320px))',
          // Anchors the optional replay overlay (#25) to the cell area.
          position: 'relative',
        }}
      >
        {grid.map((row, r) =>
          row.map((cell, c) => {
            const state = cell
              ? 'filled'
              : active.has(keyOf(r, c))
                ? 'active'
                : highlight.has(keyOf(r, c))
                  ? 'highlight'
                  : ghost.has(keyOf(r, c))
                    ? 'ghost'
                    : 'empty';

            const style: React.CSSProperties = {
              aspectRatio: '1 / 1',
              backgroundColor: '#000',
              backgroundSize: '100% 100%',
            };
            if (state === 'filled') {
              const group = (colorGrid?.[r]?.[c] || WHITE_GROUP) as ColorGroup;
              style.backgroundImage = blockBackground(group);
            } else if (state === 'active') {
              // The piece being flown (#81): the full bright sprite, with a light
              // inset edge so it reads as the live, movable piece — distinct from a
              // locked block (no edge) and the muted drop-shadow (washed down).
              style.backgroundImage = blockBackground(activeGroup);
              style.boxShadow = 'inset 0 0 0 2px rgba(255, 255, 255, 0.85)';
            } else if (state === 'ghost') {
              // The piece being positioned (#48): a muted fill — the black well
              // shows through a darkening wash over the piece-colour sprite. The
              // lowered opacity alone reads as a movable preview (#57): clearly
              // distinct from a locked block (solid sprite) and from the feedback
              // view's solid gold inset highlight, so no outline is needed. Still
              // colour-coded by piece.
              style.backgroundImage = `linear-gradient(rgba(8, 8, 8, 0.6), rgba(8, 8, 8, 0.6)), ${blockBackground(
                ghostGroup,
              )}`;
            } else if (state === 'highlight') {
              style.backgroundImage = blockBackground(highlightGroup);
              style.boxShadow = 'inset 0 0 0 1px #fcd000';
            }

            return (
              <div
                key={keyOf(r, c)}
                role="gridcell"
                data-testid={`cell-${r}-${c}`}
                data-state={state}
                className={`cell cell-${state}`}
                style={style}
              />
            );
          }),
        )}
        {overlay}
      </div>
    </div>
  );
}
