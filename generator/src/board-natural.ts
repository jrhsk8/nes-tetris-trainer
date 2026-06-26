/**
 * Board **naturalness** filter — keeps generated maneuver boards looking like real
 * NES play. Synthetic board sources (random height + carved pockets + slapped-on
 * lips) can leave **floating minos**: filled cells with empty space below and no
 * support, sometimes fully isolated islands — configurations that are impossible
 * (or vanishingly rare) in real play, and which read as "blocks floating in the
 * air" in the trainer.
 *
 * A real stack is one connected mass resting on the floor: overhangs exist (a tuck
 * slides under a ledge) but every filled cell is 4-connected to a cell on the
 * bottom row. An isolated island that never touches the floor cannot be built by
 * dropping pieces. This module rejects those, and caps the number of overhang
 * ("floating") cells so a board doesn't turn into swiss cheese.
 */

import { ROWS, COLS, type Grid } from '@trainer/core';

/** Count overhang cells: a filled cell with an empty cell directly below it. */
export function floatingCellCount(grid: Grid): number {
  let n = 0;
  for (let r = 0; r < ROWS - 1; r++)
    for (let c = 0; c < COLS; c++) if (grid[r][c] && !grid[r + 1][c]) n++;
  return n;
}

/**
 * True if some filled cell belongs to a 4-connected component that never reaches
 * the floor (`ROWS - 1`) — a floating island. Real stacks are a single grounded
 * mass (overhangs are connected to the floor through the stack); an island that
 * touches nothing below is impossible to build by dropping pieces.
 */
export function hasFloatingIsland(grid: Grid): boolean {
  const seen = Array.from({ length: ROWS }, () => new Array<boolean>(COLS).fill(false));
  const N = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!grid[r][c] || seen[r][c]) continue;
      const stack: Array<[number, number]> = [[r, c]];
      seen[r][c] = true;
      let grounded = false;
      while (stack.length) {
        const [cr, cc] = stack.pop()!;
        if (cr === ROWS - 1) grounded = true;
        for (const [dr, dc] of N) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (grid[nr][nc] && !seen[nr][nc]) {
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
      if (!grounded) return true;
    }
  }
  return false;
}

/**
 * A board looks like real NES play: no floating islands, and few enough overhang
 * cells to avoid a swiss-cheese look. A maneuver needs a couple of overhangs (the
 * lip/pocket it tucks or spins under); `maxFloating` caps the gratuitous rest.
 */
export function isNaturalBoard(grid: Grid, maxFloating = 4): boolean {
  return !hasFloatingIsland(grid) && floatingCellCount(grid) <= maxFloating;
}
