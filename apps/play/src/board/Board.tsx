/**
 * Board renderer (#10, #18, #89, v2 redesign) — a presentational 20×10 NES
 * playfield. Renders the filled stack, an optional single **floating piece**
 * (the cursor the player pilots), an optional **landing projection** (a faint
 * ghost showing where that piece will come to rest — the v2 highlight cue), and
 * optional highlight cells (used by the feedback view, #12). No input or game
 * logic lives here; it is a pure function of its props.
 *
 * v2 changes:
 *  - Slimmer, refined board well (2px bevel) instead of the chunky 4px frame.
 *  - The piloted piece is the solid bright NES sprite with a thin white inset;
 *    while it is still floating, a faint **landing projection** (`landingCells`)
 *    marks where it will rest. When it actually rests it gains a soft glow.
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
  /**
   * v2 landing projection: cells where the floating piece would come to rest if
   * dropped now. Drawn as a faint colour-coded ghost so the player can see the
   * landing as they move. Omit (or pass the same cells as `outlineCells`) when
   * the piece is already resting. Caller computes these (see HANDOFF.md).
   */
  landingCells?: readonly Cell[];
  /** Colour the landing projection as this piece (defaults to `outlinePiece`). */
  landingPiece?: Piece;
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
  landingCells = [],
  landingPiece,
  highlightCells = [],
  highlightPiece,
  overlay,
}: BoardProps) {
  const outline = new Set(onBoard(outlineCells).map(([r, c]) => keyOf(r, c)));
  const landing = new Set(onBoard(landingCells).map(([r, c]) => keyOf(r, c)));
  const highlight = new Set(onBoard(highlightCells).map(([r, c]) => keyOf(r, c)));

  const outlineGroup = outlinePiece ? PIECE_GROUP[outlinePiece] : WHITE_GROUP;
  const outlineColor = LEVEL18_PALETTE[outlineGroup];
  const landingGroup = landingPiece
    ? PIECE_GROUP[landingPiece]
    : outlinePiece
      ? PIECE_GROUP[outlinePiece]
      : WHITE_GROUP;
  const landingColor = LEVEL18_PALETTE[landingGroup];
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
                : landing.has(keyOf(r, c))
                  ? 'landing'
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
            } else if (state === 'landing') {
              // v2: landing projection — a faint colour-coded ghost of where the
              // floating piece will rest.
              style.backgroundColor = `rgba(${channels(landingColor)}, 0.09)`;
              style.boxShadow = `inset 0 0 0 2px rgba(${channels(landingColor)}, 0.5)`;
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
