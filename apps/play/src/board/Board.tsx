/**
 * Board renderer (#10, #18, #89) — a presentational 20×10 NES playfield. Renders
 * the filled stack, plus an optional single piece **outline** (the one free-
 * floating cursor the player is piloting, glowing when it rests) and optional
 * highlight cells (used by the feedback view, #12). No input or game logic lives
 * here; it is a pure function of its props.
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
import { PIECE_GROUP, blockBackground, LEVEL18_PALETTE, type ColorGroup } from './nes.js';

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
  /**
   * Cells of the **single free-floating piece outline** the player is piloting
   * (#89): a hollow, colour-coded outline drawn at the piece's current position —
   * the one cursor, no separate drop-shadow. It is the rotational/positional twin
   * of the resting cells the player will lock.
   */
  outlineCells?: readonly Cell[];
  /** Colour the outline as this piece (defaults to the white group). */
  outlinePiece?: Piece;
  /**
   * Whether the outlined piece is **resting** (#89): when true the outline gains
   * a glow — the unmistakable "ready to lock" cue. While floating (false) it is
   * a plain hollow outline.
   */
  outlineResting?: boolean;
  /** Cells to draw as a highlight (e.g. the optimal placement in feedback). */
  highlightCells?: readonly Cell[];
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
  outlineCells = [],
  outlinePiece,
  outlineResting = false,
  highlightCells = [],
  highlightPiece,
  overlay,
}: BoardProps) {
  const outline = new Set(onBoard(outlineCells).map(([r, c]) => keyOf(r, c)));
  const highlight = new Set(onBoard(highlightCells).map(([r, c]) => keyOf(r, c)));
  const outlineGroup = outlinePiece ? PIECE_GROUP[outlinePiece] : WHITE_GROUP;
  const outlineColor = LEVEL18_PALETTE[outlineGroup];
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
              : outline.has(keyOf(r, c))
                ? outlineResting
                  ? 'outline-resting'
                  : 'outline'
                : highlight.has(keyOf(r, c))
                  ? 'highlight'
                  : 'empty';

            const style: React.CSSProperties = {
              aspectRatio: '1 / 1',
              backgroundColor: '#000',
              backgroundSize: '100% 100%',
            };
            if (state === 'filled') {
              const group = (colorGrid?.[r]?.[c] || WHITE_GROUP) as ColorGroup;
              style.backgroundImage = blockBackground(group);
            } else if (state === 'outline' || state === 'outline-resting') {
              // The single free-floating piece (#89): a hollow, colour-coded
              // outline (the black well shows through) — one cursor that can tuck,
              // spin, and freely move. While floating it is a plain outline; the
              // moment it RESTS (can't fall) it gains a glow, the "ready to lock"
              // cue that gates Confirm. No separate drop-shadow exists, so there
              // is never the old "awkward partial ghost".
              style.boxShadow =
                state === 'outline-resting'
                  ? `inset 0 0 0 2px ${outlineColor}, 0 0 7px 2px ${outlineColor}`
                  : `inset 0 0 0 2px ${outlineColor}`;
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
