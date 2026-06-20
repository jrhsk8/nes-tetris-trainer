/**
 * Tetromino names and orientation tables. Pure data + a guard; no board,
 * engine, or DOM dependency. Issue #3 (shared by #10's renderer and the
 * generator).
 */

/** The seven tetrominoes, by their conventional single-letter names. */
export const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

/** A tetromino name. */
export type Piece = (typeof PIECES)[number];

/** True if `value` is one of the seven tetromino names. */
export function isPiece(value: unknown): value is Piece {
  return typeof value === 'string' && (PIECES as readonly string[]).includes(value);
}

/** A single oriented shape: the `[row, col]` cells of its (normalized) bounding box. */
export type Orientation = ReadonlyArray<readonly [number, number]>;

/**
 * Orientation tables, one entry per rotation state. Each shape is given as
 * `[row, col]` offsets normalized so the bounding box starts at `(0, 0)`, with
 * row increasing DOWNWARD (matching `Grid`). Rotation index 0 is the spawn
 * orientation; indices increase clockwise. Pieces with fewer distinct states
 * (O has 1; I/S/Z have 2) list only those, and `applyPlacement` wraps the
 * rotation index modulo the table length.
 *
 * NOTE: these are the conventional NES shapes. The rotation-INDEX numbering
 * (which state is "0", "1", …) must be reconciled with StackRabbit's output
 * when the engine client lands (#4) — the integration smoke test there is the
 * place that pins it down against a live engine.
 */
export const ORIENTATIONS: Record<Piece, readonly Orientation[]> = {
  O: [
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  ],
  I: [
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  ],
  T: [
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  ],
  S: [
    [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  ],
  Z: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
  ],
  J: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 0],
      [2, 1],
    ],
  ],
  L: [
    [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  ],
};
