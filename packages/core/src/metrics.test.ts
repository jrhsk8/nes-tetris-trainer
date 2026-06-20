import { describe, it, expect } from 'vitest';
import {
  emptyBoard,
  columnHeights,
  aggregateHeight,
  bumpiness,
  holes,
  boardMetrics,
} from './index.js';

describe('board metrics', () => {
  it('reports zero metrics for an empty board', () => {
    const m = boardMetrics(emptyBoard());
    expect(m.columnHeights).toEqual(new Array(10).fill(0));
    expect(m.aggregateHeight).toBe(0);
    expect(m.bumpiness).toBe(0);
    expect(m.holes).toBe(0);
  });

  it('measures column heights from the top-most filled cell', () => {
    const grid = emptyBoard();
    grid[19][0] = 1; // height 1
    grid[18][1] = 1;
    grid[19][1] = 1; // height 2
    grid[10][2] = 1; // height 10 (top-most cell wins, gaps below ignored for height)
    const heights = columnHeights(grid);
    expect(heights[0]).toBe(1);
    expect(heights[1]).toBe(2);
    expect(heights[2]).toBe(10);
    expect(aggregateHeight(grid)).toBe(13);
  });

  it('sums absolute differences between adjacent columns for bumpiness', () => {
    const grid = emptyBoard();
    grid[19][0] = 1; // height 1
    grid[18][1] = 1;
    grid[19][1] = 1; // height 2
    // heights: [1, 2, 0, 0, ...] → |1-2| + |2-0| = 3
    expect(bumpiness(grid)).toBe(3);
  });

  it('counts only empty cells covered from above as holes', () => {
    const grid = emptyBoard();
    grid[18][0] = 1; // covers the empty floor cell (19,0) → 1 hole
    grid[19][1] = 1; // a surface cell, nothing above it → no hole
    expect(holes(grid)).toBe(1);
  });
});
