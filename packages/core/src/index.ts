/**
 * @trainer/core — pure puzzle logic shared by the play app and the offline
 * generator. No engine, network, or DOM dependencies live here.
 *
 * Landed so far: the piece tables, board model + metrics (#3), and the checker
 * (#5). The rating glue (#6) re-exports from here when it lands.
 */

export { PIECES, isPiece, ORIENTATIONS } from './pieces.js';
export type { Piece, Orientation } from './pieces.js';

export {
  ROWS,
  COLS,
  emptyBoard,
  cloneBoard,
  decodeBoard,
  encodeBoard,
  applyPlacement,
  restingCells,
  clearFullRows,
} from './board.js';
export type { Grid, Placement } from './board.js';

export { columnHeights, aggregateHeight, bumpiness, holes, boardMetrics } from './metrics.js';
export type { BoardMetrics } from './metrics.js';

export { gradeAttempt } from './checker.js';
export type { Line, AttemptResult } from './checker.js';
