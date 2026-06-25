/**
 * Board renderer (#10, #18, #89, #93, v2 redesign) — a presentational 20×10 NES
 * playfield. Renders the filled stack, an optional single **floating piece**
 * (the cursor the player pilots), and optional highlight cells (used by the
 * feedback view, #12). No input or game logic lives here; it is a pure function
 * of its props.
 *
 * v2 changes:
 *  - Slimmer, refined board well (2px bevel) instead of the chunky 4px frame.
 *  - The piloted piece is the solid bright NES sprite with a thin white inset;
 *    when it actually rests it gains a soft glow. There is exactly ONE outline —
 *    no separate landing projection (#93): dropping is how the player sees where
 *    the piece lands.
 *
 * Cells are drawn as pixel-accurate NES level-18 block sprites (see `nes.ts`).
 */

import type { ReactNode } from 'react';
import { COLS, ROWS, type ColorGrid, type Grid, type Piece } from '@trainer/core';
import { PIECE_GROUP, blockBackground, LEVEL18_PALETTE, type ColorGroup } from './nes.js';

/** A `[row, col]` cell coordinate. */
export type Cell = readonly [number, number];

export interface BoardProps {
  /** The board grid to render. */
  grid: Grid;
  /** Optional colour grid parallel to `grid` (#28). */
  colorGrid?: ColorGrid;
  /** Cells of the single free-floating piece the player is piloting (#89). */
  outlineCells?: readonly Cell[];
  /** Colour the floating piece as this piece (defaults to the white group). */
  outlinePiece?: Piece;
  /** Whether the floating piece is resting (#89) — gains a soft glow. */
  outlineResting?: boolean;
  /** Cells to draw as a highlight (e.g. the optimal placement in feedback). */
  highlightCells?: readonly Cell[];
  /** Colour the highlight cells as this piece (defaults to the white group). */
  highlightPiece?: Piece;
  /** An absolutely-positioned layer drawn over the grid (replay/flash, #25). */
  overlay?: ReactNode;
}

const keyOf = (r: number, c: number) => `${r}-${c}`;

const onBoard = (cells: readonly Cell[]): Cell[] =>
  cells.filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS);

const WHITE_GROUP: ColorGroup = 1;

/** `r,g,b` channels of a `#rrggbb` colour, for building rgba() shadows. */
function channels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

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
        // v2: slimmer, refined bevel.
        padding: 5,
        background: '#000',
        border: '2px solid #a8a8a8',
        boxShadow: '0 0 0 1px #000, 0 0 0 3px #555',
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
          width: 'var(--board-width, min(86vw, 320px))',
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
              // v2: the piloted piece is the solid bright sprite with a thin
              // white inset; resting adds a soft outer glow ("ready to lock").
              style.backgroundImage = blockBackground(outlineGroup);
              style.boxShadow =
                state === 'outline-resting'
                  ? `inset 0 0 0 1px rgba(255, 255, 255, 0.7), 0 0 14px 1px rgba(${channels(outlineColor)}, 0.7)`
                  : 'inset 0 0 0 1px rgba(255, 255, 255, 0.55)';
            } else if (state === 'highlight') {
              style.backgroundImage = blockBackground(highlightGroup);
              style.boxShadow = 'inset 0 0 0 1px #d98b6a';
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
