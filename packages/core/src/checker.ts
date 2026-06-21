/**
 * Checker (v1) — pure exact-match, solve-the-whole-line grading of a player's
 * attempt against the stored optimal two-ply line. No engine, network, or DOM
 * dependency. Issue #5 (see docs/PRD-v1.md, "Checker").
 *
 * Rule: the player must match the optimal FIRST placement and the optimal
 * SECOND placement, where matching means the same final resting column +
 * rotation. A wrong first placement fails the puzzle immediately and the second
 * move is NOT separately graded — the optimal second move assumed the optimal
 * first move, so grading it in isolation would be meaningless.
 */

import type { Placement } from './board.js';

/**
 * An ordered two-placement line: the first placement, then the second. Both the
 * stored optimal solution and the player's attempt take this shape.
 */
export type Line = readonly [Placement, Placement];

/** The graded outcome of an attempt. */
export interface AttemptResult {
  /** True only if BOTH plies match the optimal line. */
  solved: boolean;
  /** True if the first placement matches the optimal first placement. */
  firstCorrect: boolean;
  /**
   * True if the second placement matches the optimal second placement. Always
   * `false` when the first move is wrong — the second move is not graded then.
   */
  secondCorrect: boolean;
}

/** True if two placements rest at the same column in the same rotation. */
function placementsEqual(a: Placement, b: Placement): boolean {
  return a.rotation === b.rotation && a.col === b.col;
}

/**
 * Grade a player's `user` line against the stored `optimal` line using the
 * exact-match, whole-line rule. A wrong first move ends the puzzle and leaves
 * the second move ungraded (`secondCorrect: false`).
 *
 * @deprecated Superseded by combo-threshold grading ({@link gradeCombo}, #34).
 * Still used by the play session until the state machine is reworked to place
 * both pieces always (#35); removed then.
 */
export function gradeAttempt(optimal: Line, user: Line): AttemptResult {
  const firstCorrect = placementsEqual(optimal[0], user[0]);
  if (!firstCorrect) {
    return { solved: false, firstCorrect: false, secondCorrect: false };
  }
  const secondCorrect = placementsEqual(optimal[1], user[1]);
  return { solved: secondCorrect, firstCorrect: true, secondCorrect };
}
