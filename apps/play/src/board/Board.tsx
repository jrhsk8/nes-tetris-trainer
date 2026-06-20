/**
 * Board renderer (#10, #18) — a presentational 20×10 NES playfield. Renders the
 * filled stack, plus optional ghost cells (the piece the player is positioning)
 * and optional highlight cells (used by the feedback view, #12). No input or
 * game logic lives here; it is a pure function of its props.
 *
 * Cells are drawn as pixel-accurate NES level-18 block sprites (see `nes.ts`),
 * crisp at any scale. The current/optimal piece is coloured by its real NES
 * colour group; the existing stack — whose per-cell piece identity is not
 * tracked in the binary `Grid` — falls back to the white block group.
 */

import { COLS, type Grid, type Piece } from '@trainer/core';
import { PIECE_GROUP, blockBackground, type ColorGroup } from './nes.js';

/** A `[row, col]` cell coordinate. */
export type Cell = readonly [number, number];

export interface BoardProps {
  /** The board grid to render. */
  grid: Grid;
  /** Cells to draw as the piece being positioned. */
  ghostCells?: readonly Cell[];
  /** Cells to draw as a highlight (e.g. the optimal placement in feedback). */
  highlightCells?: readonly Cell[];
  /** Colour the ghost cells as this piece (defaults to the white group). */
  ghostPiece?: Piece;
  /** Colour the highlight cells as this piece (defaults to the white group). */
  highlightPiece?: Piece;
}

const keyOf = (r: number, c: number) => `${r}-${c}`;

const WHITE_GROUP: ColorGroup = 1;

export function Board({
  grid,
  ghostCells = [],
  highlightCells = [],
  ghostPiece,
  highlightPiece,
}: BoardProps) {
  const ghost = new Set(ghostCells.map(([r, c]) => keyOf(r, c)));
  const highlight = new Set(highlightCells.map(([r, c]) => keyOf(r, c)));
  const ghostGroup = ghostPiece ? PIECE_GROUP[ghostPiece] : WHITE_GROUP;
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
        }}
      >
        {grid.map((row, r) =>
          row.map((cell, c) => {
            const state = cell
              ? 'filled'
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
              style.backgroundImage = blockBackground(WHITE_GROUP);
            } else if (state === 'ghost') {
              style.backgroundImage = blockBackground(ghostGroup);
              style.opacity = 0.5;
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
      </div>
    </div>
  );
}
