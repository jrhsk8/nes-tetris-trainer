import { describe, it, expect } from 'vitest';
import { emptyBoard, decodeBoard, type Grid } from './board.js';
import { slideReachableAtSpeed, spinReachableAtSpeed } from './nes-reachability.js';
import { maneuver, isSpintuck } from './tags.js';
import type { RestingPlacement } from './placement.js';

/** Fill every column in `cols` over the inclusive row range [r0,r1]. */
function fillRows(g: Grid, r0: number, r1: number, cols: number[]): Grid {
  for (let r = r0; r <= r1; r++) for (const c of cols) g[r][c] = 1;
  return g;
}

/** The owner's J board: a J rotated to point-down seats under the row-12 lip. */
function ownerJBoard(): Grid {
  let g = emptyBoard();
  g = fillRows(g, 11, 11, [0, 1]);
  g = fillRows(g, 12, 12, [0, 1, 2, 3]);
  g = fillRows(g, 13, 13, [0, 1]);
  g = fillRows(g, 14, 14, [0, 1, 2, 3]);
  g = fillRows(g, 15, 16, [0, 1, 2, 3, 4, 5, 6]);
  g = fillRows(g, 17, 17, [0, 1, 2, 3, 4, 5, 6, 7]);
  g = fillRows(g, 18, 19, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  return g;
}

describe('NES 19+ reachability (spintuck timing)', () => {
  it("owner's J: under-lip 2-cell slide is NOT slide-reachable at speed, but the spin is", () => {
    const g = ownerJBoard();
    const p: RestingPlacement = { rotation: 2, row: 13, col: 2 };
    expect(maneuver(g, 'J', p)).toBe('tuck'); // slide-reachable given unlimited time
    expect(slideReachableAtSpeed(g, 'J', p)).toBe(false); // 2 shifts under the lip — too slow at 19
    expect(spinReachableAtSpeed(g, 'J', p)).toBe(true); // a last-second rotation seats it
    expect(isSpintuck(g, 'J', p)).toBe(true);
  });

  it('a single under-lip shift IS slide-reachable at speed (plain tuck)', () => {
    // A 4-wide ledge at row 10; a vertical I enters col 4 from the ledge-free col 3
    // with ONE under-lip shift — doable pre-rotated at 19 speed.
    let g = emptyBoard();
    g = fillRows(g, 10, 10, [4, 5, 6, 7]);
    const p: RestingPlacement = { rotation: 1, row: 16, col: 4 };
    expect(maneuver(g, 'I', p)).toBe('tuck');
    expect(slideReachableAtSpeed(g, 'I', p)).toBe(true);
    expect(isSpintuck(g, 'I', p)).toBe(false);
  });

  it('a pure spin (rotate straight down a pocket) is never a spintuck', () => {
    const g = decodeBoard(
      '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000100001000010000100001000010000100101000000010100001011000000101100010100110100011011110101110011010',
    );
    const p: RestingPlacement = { rotation: 3, row: 15, col: 6 };
    expect(maneuver(g, 'T', p)).toBe('spin'); // not slide-reachable even with unlimited time
    expect(isSpintuck(g, 'T', p)).toBe(false);
  });

  it('a hard-drop is reachable at speed and never a spintuck', () => {
    const g = emptyBoard();
    const p: RestingPlacement = { rotation: 0, row: 18, col: 0 }; // O bottom-left on empty board
    expect(slideReachableAtSpeed(g, 'O', p)).toBe(true);
    expect(isSpintuck(g, 'O', p)).toBe(false);
  });
});
