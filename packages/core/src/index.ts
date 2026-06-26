/**
 * @trainer/core — pure puzzle logic shared by the play app and the offline
 * generator. No engine, network, or DOM dependencies live here.
 *
 * Landed so far: the piece tables, board model + metrics (#3), and the checker
 * (#5). The rating glue (#6) re-exports from here when it lands.
 */

export { PIECES, isPiece, ORIENTATIONS, PIECE_GROUP } from './pieces.js';
export type { Piece, Orientation, ColorGroup } from './pieces.js';

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
  emptyColorGrid,
  cloneColorGrid,
  encodeColors,
  decodeColors,
  applyPlacementColored,
} from './board.js';
export type { Grid, Placement, ColorGrid, Line } from './board.js';

export {
  pieceCells,
  fitsAt,
  isResting,
  applyRestingPlacement,
  reachableStates,
  enumerateResting,
  inputReachableRestingPlacements,
  isInputReachable,
  moveToColumn,
  lateralMove,
  spin,
  rotationDelta,
  boardKey,
  resolveLineByOutcome,
} from './placement.js';
export type { RestingPlacement } from './placement.js';

export { columnHeights, aggregateHeight, bumpiness, holes, boardMetrics } from './metrics.js';
export type { BoardMetrics } from './metrics.js';

export {
  gradeCombo,
  comboOutcomeKey,
  CORRECT_SCORE_THRESHOLD,
} from './combo.js';
export type { ComboEntry, ComboTable, ComboResult } from './combo.js';

export {
  restingLineForEntry,
  lockAndClear,
  lineClearsTetris,
  entryClearsTetris,
} from './combo-replay.js';

export {
  tagPuzzle,
  maneuver,
  isSpintuck,
  WELL_DEPTH,
  singlePieceDependencies,
  AVOID_DEPENDENCY_TAG,
  SPIN_TAG,
  I_WELL_MIN_DEPTH,
  TRAP_BAND_MIN,
  TRAP_BAND_MAX,
  TRAP_MAX_RANK,
} from './tags.js';
export type { PuzzleTag, Dependency } from './tags.js';
