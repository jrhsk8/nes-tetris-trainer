import { describe, it, expect } from 'vitest';
import {
  applyRestingPlacement,
  maneuver,
  isInputReachable,
  isResting,
  boardKey,
  SPIN_TAG,
  type Piece,
} from '@trainer/core';
import { constructForcedSpin, FORCED_SPIN_PIECES, cellCount } from './forced-spin.js';

/**
 * The forced-spin constructor (#94) is the generation half of the per-piece spin
 * bank: every construction it returns must be a genuine, reachable, line-clearing
 * SPIN of the named piece — the exact property the bank runner then asks the
 * engines to also agree on. These deep tests assert that user-visible contract on
 * real constructions, not internals.
 */
describe('constructForcedSpin (#94 per-piece forced line-clearing spin)', () => {
  for (const piece of FORCED_SPIN_PIECES as Piece[]) {
    it(`${piece}: yields constructions, each a reachable line-clearing ${SPIN_TAG[piece]}`, () => {
      let found = 0;
      for (let i = 0; i < 400 && found < 5; i++) {
        const c = constructForcedSpin(piece);
        if (!c) continue;
        found++;

        // Piece 2 is the named piece; piece 1 is the O setup.
        expect(c.piece2).toBe(piece);
        expect(c.piece1).toBe('O');
        expect(c.tag).toBe(SPIN_TAG[piece]);

        // Piece 1 (O) hard-drops into its gap; replay to the surface piece 2 rests on.
        const board1 = applyRestingPlacement(c.board, 'O', c.p1);
        expect(boardKey(board1)).toBe(c.p1_key);

        // Piece 2's stored placement genuinely rests there.
        expect(isResting(board1, piece, c.p2.rotation, c.p2.row, c.p2.col)).toBe(true);

        // It is a SPIN (rotation-at-depth), not a tuck or hard drop.
        expect(maneuver(board1, piece, c.p2)).toBe('spin');

        // It is reachable by the real play input under the descending-spin law (#91).
        expect(isInputReachable(board1, piece, c.p2)).toBe(true);

        // It clears at least two lines (the forced double).
        const after = applyRestingPlacement(board1, piece, c.p2);
        const clears = (cellCount(board1) + 4 - cellCount(after)) / 10;
        expect(clears).toBeGreaterThanOrEqual(2);
        expect(boardKey(after)).toBe(c.full_key);
      }
      expect(found, `expected forced ${piece}-spins to be constructible`).toBeGreaterThanOrEqual(5);
    });
  }

  it('only spinnable forced-spin pieces are offered (S/Z excluded — their line maneuver is a tuck)', () => {
    expect(FORCED_SPIN_PIECES).toEqual(['T', 'J', 'L']);
    expect(constructForcedSpin('S')).toBeNull();
    expect(constructForcedSpin('Z')).toBeNull();
    expect(constructForcedSpin('O')).toBeNull();
    expect(constructForcedSpin('I')).toBeNull();
  });
});
