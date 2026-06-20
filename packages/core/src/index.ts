/**
 * @trainer/core — pure puzzle logic shared by the play app and the offline
 * generator. No engine, network, or DOM dependencies live here.
 *
 * Landed so far: the piece tables and board model + metrics (#3). The checker
 * (#5) and rating glue (#6) re-export from here when they land.
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
  clearFullRows,
} from './board.js';
export type { Grid, Placement } from './board.js';

export { columnHeights, aggregateHeight, bumpiness, holes, boardMetrics } from './metrics.js';
export type { BoardMetrics } from './metrics.js';
