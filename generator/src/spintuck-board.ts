/**
 * Constructive **spintuck board** source. Random board generation almost never
 * produces spintuck geometry (and the messy carving that occasionally did also
 * scattered floating minos), so we build the owner's J-board pattern on purpose:
 * a supported left wall anchoring a **roofed pocket** (buried holes under a lip),
 * an open **entry column** beside it, and a rising staircase to the wall. A piece
 * descends the entry column and must rotate at the last second to sweep under the
 * lip into the pocket — a spintuck. Every cell is grounded by construction, so the
 * board is natural (no floating islands).
 *
 * The geometry is randomized (pocket row/width/depth, wall height, entry side via
 * mirroring, staircase) so the set varies; the caller searches all pieces for the
 * one(s) the pocket actually hosts (see findSpintuck), preferring hole-reducing
 * digs (which StackRabbit ranks #1).
 */

import { emptyBoard, type Grid } from '@trainer/core';

const R = (n: number): number => Math.floor(Math.random() * n);

/** Build one randomized, fully-supported board with a roofed spintuck pocket. */
export function constructSpintuckBoard(): Grid {
  for (let attempt = 0; attempt < 20; attempt++) {
    const b = emptyBoard();
    const pw = 2 + R(2); // pocket width 2..3 (the bar sweeps under the lip)
    const depth = 1 + R(2); // pocket depth 1..2 rows of buried holes
    const pr = 10 + R(4); // top hole row 10..13
    const p = 1 + R(2); // pocket left column 1..2 (room for wall left, entry+stair right)
    const roofRow = pr - 1;
    const floorRow = pr + depth; // first filled row beneath the holes
    const ec = p + pw; // entry column (open above the floor)
    if (floorRow > 18 || ec > 7) continue; // need room for entry + a staircase

    // Left wall: cols 0..p-1 solid from the roof row down — anchors the roof.
    for (let c = 0; c < p; c++) for (let r = roofRow; r <= 19; r++) b[r][c] = 1;
    // Roof over the pocket (connected leftward to the wall).
    for (let c = p; c < p + pw; c++) b[roofRow][c] = 1;
    // Pocket floor + everything below (the holes are rows pr..floorRow-1).
    for (let c = p; c < p + pw; c++) for (let r = floorRow; r <= 19; r++) b[r][c] = 1;
    // Entry column: floored at the same level, open above so a piece descends in.
    for (let r = floorRow; r <= 19; r++) b[r][ec] = 1;
    // Right region: a rising staircase up toward the wall. Stop before col 9 so it
    // stays an empty well — this guarantees no full rows (a full row can't exist in
    // real play, it would have cleared) while every filled column is grounded.
    let top = floorRow;
    for (let c = ec + 1; c < 9; c++) {
      top = Math.max(2, top - R(3));
      for (let r = top; r <= 19; r++) b[r][c] = 1;
    }
    if (R(2) === 0) for (let r = 0; r < 20; r++) b[r].reverse(); // mirror for variety
    return b;
  }
  return emptyBoard();
}
