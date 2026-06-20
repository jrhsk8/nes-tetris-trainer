/**
 * Geometric board metrics — pure functions used to compare a player's result
 * board against the stored optimal result (#12). No engine dependency: the
 * optimal-side metrics are precomputed offline and the player-side ones are
 * computed here, client-side. Issue #3.
 */

import { ROWS, COLS, type Grid } from './board.js';

/** Geometric summary of a board. */
export interface BoardMetrics {
  /** Filled height of each of the `COLS` columns (0 = empty column). */
  columnHeights: number[];
  /** Sum of all column heights. */
  aggregateHeight: number;
  /** Sum of absolute height differences between adjacent columns. */
  bumpiness: number;
  /** Empty cells that have at least one filled cell somewhere above them. */
  holes: number;
}

/**
 * Height of each column: `ROWS` minus the row index of its top-most filled
 * cell, or 0 for an empty column.
 */
export function columnHeights(grid: Grid): number[] {
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

/** Total filled height across all columns. */
export function aggregateHeight(grid: Grid): number {
  return columnHeights(grid).reduce((sum, h) => sum + h, 0);
}

/** Sum of absolute height differences between each pair of adjacent columns. */
export function bumpiness(grid: Grid): number {
  const heights = columnHeights(grid);
  let total = 0;
  for (let col = 0; col < COLS - 1; col++) {
    total += Math.abs(heights[col] - heights[col + 1]);
  }
  return total;
}

/** Count of empty cells covered by at least one filled cell higher in the column. */
export function holes(grid: Grid): number {
  let count = 0;
  for (let col = 0; col < COLS; col++) {
    let covered = false;
    for (let row = 0; row < ROWS; row++) {
      if (grid[row][col]) covered = true;
      else if (covered) count++;
    }
  }
  return count;
}

/** Compute every board metric in one pass-friendly bundle. */
export function boardMetrics(grid: Grid): BoardMetrics {
  const heights = columnHeights(grid);
  let bump = 0;
  for (let col = 0; col < COLS - 1; col++) {
    bump += Math.abs(heights[col] - heights[col + 1]);
  }
  return {
    columnHeights: heights,
    aggregateHeight: heights.reduce((sum, h) => sum + h, 0),
    bumpiness: bump,
    holes: holes(grid),
  };
}
