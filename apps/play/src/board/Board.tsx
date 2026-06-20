/**
 * Board renderer (#10) — a presentational 20x10 grid. Renders filled stack
 * cells, plus optional ghost cells (the piece the player is positioning) and
 * optional highlight cells (used later by the feedback view, #12). No input or
 * game logic lives here; it is a pure function of its props.
 */

import { COLS, type Grid } from '@trainer/core';

/** A `[row, col]` cell coordinate. */
export type Cell = readonly [number, number];

export interface BoardProps {
  /** The board grid to render. */
  grid: Grid;
  /** Cells to draw as a translucent ghost (the piece being positioned). */
  ghostCells?: readonly Cell[];
  /** Cells to draw as a highlight (e.g. the optimal placement in feedback). */
  highlightCells?: readonly Cell[];
}

const keyOf = (r: number, c: number) => `${r}-${c}`;

const CELL_COLOR: Record<string, string> = {
  filled: '#4a90d9',
  ghost: 'rgba(255, 255, 255, 0.35)',
  highlight: 'rgba(80, 220, 120, 0.65)',
  empty: '#111827',
};

export function Board({ grid, ghostCells = [], highlightCells = [] }: BoardProps) {
  const ghost = new Set(ghostCells.map(([r, c]) => keyOf(r, c)));
  const highlight = new Set(highlightCells.map(([r, c]) => keyOf(r, c)));

  return (
    <div
      role="grid"
      aria-label="board"
      className="board"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gap: 1,
        width: 'min(90vw, 300px)',
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
          return (
            <div
              key={keyOf(r, c)}
              role="gridcell"
              data-testid={`cell-${r}-${c}`}
              data-state={state}
              className={`cell cell-${state}`}
              style={{ aspectRatio: '1 / 1', backgroundColor: CELL_COLOR[state] }}
            />
          );
        }),
      )}
    </div>
  );
}
