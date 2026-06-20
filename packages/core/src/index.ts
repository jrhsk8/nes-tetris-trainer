/**
 * @trainer/core — pure puzzle logic shared by the play app and the offline
 * generator. No engine, network, or DOM dependencies live here.
 *
 * This module is intentionally thin for the scaffold (issue #1). The board
 * model, metrics, checker, and rating glue land in their own issues (#3, #5,
 * #6) and re-export from here.
 */

/** The seven tetrominoes, by their conventional single-letter names. */
export const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

/** A tetromino name. */
export type Piece = (typeof PIECES)[number];

/** True if `value` is one of the seven tetromino names. */
export function isPiece(value: unknown): value is Piece {
  return typeof value === 'string' && (PIECES as readonly string[]).includes(value);
}
