/**
 * Automatic puzzle **type-tags** (#81) — a pure, engine-free classifier that
 * labels a puzzle by what its **optimal (rank-1) line** does, so puzzles are
 * self-describing (display), filterable (drill mode), and trackable per-skill.
 *
 * A puzzle may carry several tags; **zero tags is allowed**. Every predicate is
 * computed on the rank-1 two-piece line, reconstructed from the stored combo
 * entry via {@link restingLineForEntry} (it decodes the entry's `boardKey`), so
 * no StackRabbit / network / DOM is touched. `start` = the puzzle board before
 * either placement, `after` = the board after BOTH placements (full rows
 * cleared, as in play).
 *
 * See PRD § type-tags and the grill of 2026-06-23 (Q2: tags reflect the optimal
 * line). The contrast tags (`avoid-<piece>-dependency`, #90) extend this module
 * and additionally read the full combo table.
 */

import { ROWS, COLS, decodeBoard, type Grid } from './board.js';
import { ORIENTATIONS, type Piece } from './pieces.js';
import { fitsAt, pieceCells, enumerateResting, type RestingPlacement } from './placement.js';
import { columnHeights, holes } from './metrics.js';
import type { ComboEntry, ComboTable } from './combo.js';
import { restingLineForEntry, lockAndClear, lineClearsTetris } from './combo-replay.js';

/**
 * The closed set of puzzle type-tags (#81). Each reflects a property of the
 * puzzle's optimal / rank-1 line.
 */
export type PuzzleTag =
  | 'burn'
  | 'tetris'
  | 'tetris-ready'
  | 'tuck'
  | 'spin'
  | 't-spin'
  | 's-spin'
  | 'z-spin'
  | 'l-spin'
  | 'j-spin'
  | 'clean-stacking'
  | 'dig'
  | 'well-maintenance'
  | 'avoid-i-dependency'
  | 'avoid-s-dependency'
  | 'avoid-z-dependency'
  | 'avoid-j-dependency'
  | 'avoid-l-dependency';

/**
 * The single source of truth mapping a **dependency piece** to its
 * `avoid-<piece>-dependency` tag (#90) — so the detector, the tagger, and the
 * future chip/drill vocabulary all agree. O and T have no single-piece
 * dependency, so they map to `null`.
 */
export const AVOID_DEPENDENCY_TAG: Record<Piece, PuzzleTag | null> = {
  I: 'avoid-i-dependency',
  S: 'avoid-s-dependency',
  Z: 'avoid-z-dependency',
  J: 'avoid-j-dependency',
  L: 'avoid-l-dependency',
  O: null,
  T: null,
};

/**
 * The per-piece **spin** tag: a spin (rotation-at-depth placement) is tagged by
 * which piece performed it. O cannot rotate and I is not a meaningful spin piece,
 * so they map to `null`; the five spinnable pieces each get a `<piece>-spin` tag
 * (alongside the umbrella `spin` tag).
 */
export const SPIN_TAG: Record<Piece, PuzzleTag | null> = {
  T: 't-spin',
  S: 's-spin',
  Z: 'z-spin',
  L: 'l-spin',
  J: 'j-spin',
  I: null,
  O: null,
};

/**
 * How much deeper than BOTH its neighbours a column must be to count as an open
 * **well** for the `well-maintenance` tag — a named, tunable constant (default
 * 3). `tetris-ready` uses a fixed depth of 4 (a clearing vertical I).
 */
export const WELL_DEPTH = 3;

/**
 * The column indices that are open **wells**: at least {@link WELL_DEPTH} lower
 * than EVERY existing neighbour (edge columns have one neighbour). A single such
 * column is the well a `well-maintenance` puzzle keeps open.
 */
function wellColumns(grid: Grid, minDepth = WELL_DEPTH): number[] {
  const h = columnHeights(grid);
  const wells: number[] = [];
  for (let c = 0; c < COLS; c++) {
    const neighbours: number[] = [];
    if (c > 0) neighbours.push(h[c - 1]);
    if (c < COLS - 1) neighbours.push(h[c + 1]);
    if (neighbours.every((nh) => nh - h[c] >= minDepth)) wells.push(c);
  }
  return wells;
}

/** True if a vertical I-piece can clear 4 rows in SOME column of `grid`. */
function tetrisReady(grid: Grid): boolean {
  const vertical = ORIENTATIONS.I.length - 1; // the column orientation (index 1)
  return enumerateResting(grid, 'I')
    .filter((p) => p.rotation === vertical)
    .some((p) => lockAndClear(grid, 'I', p).cleared === 4);
}

/**
 * The lowest row a piece reaches by a pure straight-down drop in `col` at the
 * fixed `rotation` (entering from the top), or `null` when it cannot even enter
 * the column from the top. A resting placement whose row exceeds this is reached
 * only by manoeuvring (a tuck or a spin), never a hard drop.
 */
function hardDropRow(
  grid: Grid,
  piece: Piece,
  rotation: number,
  col: number,
): number | null {
  if (!fitsAt(grid, piece, rotation, 0, col)) return null;
  let row = 0;
  while (fitsAt(grid, piece, rotation, row + 1, col)) row++;
  return row;
}

/** Is `placement` reachable by simply choosing a column + rotation and hard-dropping? */
function isHardDrop(grid: Grid, piece: Piece, placement: RestingPlacement): boolean {
  return hardDropRow(grid, piece, placement.rotation, placement.col) === placement.row;
}

function transKey(row: number, col: number): number {
  return row * COLS + col;
}

/**
 * Is `(rotation, targetRow, targetCol)` reachable by a **translation-only** BFS —
 * down / left / right with the orientation held fixed, entering from the top?
 * This is the tuck/spin splitter (#81): a non-hard-drop placement that is
 * translation-reachable is a **tuck** (slid under an overhang); one that is NOT
 * is a **spin** (it needs a rotation at depth).
 */
function translationReachable(
  grid: Grid,
  piece: Piece,
  rotation: number,
  targetRow: number,
  targetCol: number,
): boolean {
  const seen = new Set<number>();
  const queue: Array<[number, number]> = [];
  const visit = (r: number, c: number): void => {
    if (!fitsAt(grid, piece, rotation, r, c)) return;
    const k = transKey(r, c);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push([r, c]);
  };
  for (let c = 0; c < COLS; c++) visit(0, c); // enter from the top
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    visit(r + 1, c); // soft-drop
    visit(r, c - 1); // left
    visit(r, c + 1); // right
  }
  return seen.has(transKey(targetRow, targetCol));
}

/** Whether a resting placement is a tuck, a spin, or a plain hard drop. */
export function maneuver(
  grid: Grid,
  piece: Piece,
  placement: RestingPlacement,
): 'hard-drop' | 'tuck' | 'spin' {
  if (isHardDrop(grid, piece, placement)) return 'hard-drop';
  return translationReachable(grid, piece, placement.rotation, placement.row, placement.col)
    ? 'tuck'
    : 'spin';
}

// --- Single-piece dependencies + avoid-<piece> contrast tags (#90) ----------

/**
 * A **single-piece dependency**: a notch on the resulting board that exactly one
 * piece can hard-drop to fill cleanly (no new hole, no line clear). `col` is the
 * notch's deepest column.
 */
export interface Dependency {
  piece: Piece;
  col: number;
}

/** The candidate fillers for any non-well notch — O and T are excluded (#90). */
const DEP_CANDIDATES: readonly Piece[] = ['S', 'Z', 'J', 'L'];
/** A 1-wide vertical well this deep (or deeper) is an I-dependency. */
export const I_WELL_MIN_DEPTH = 3;

/** Lowest row a piece reaches by a straight drop in `col` at `rotation`, or null. */
function straightDropRow(grid: Grid, piece: Piece, rotation: number, col: number): number | null {
  if (!fitsAt(grid, piece, rotation, 0, col)) return null;
  let row = 0;
  while (fitsAt(grid, piece, rotation, row + 1, col)) row++;
  return row;
}

/** True if hard-dropping `piece` at `placement` adds no new hole and clears no line. */
function isCleanFill(grid: Grid, piece: Piece, placement: RestingPlacement): boolean {
  const before = holes(grid);
  const { cleared, board } = lockAndClear(grid, piece, placement);
  if (cleared > 0) return false;
  return holes(board) <= before;
}

/** Does `placement` of `piece` occupy board cell `(r, c)`? */
function coversCell(piece: Piece, placement: RestingPlacement, r: number, c: number): boolean {
  return pieceCells(piece, placement.rotation, placement.row, placement.col).some(
    ([pr, pc]) => pr === r && pc === c,
  );
}

/** Which of {S,Z,J,L} can hard-drop to clean-fill the cell `(r, c)`. */
function fittersForCell(grid: Grid, r: number, c: number): Piece[] {
  const out: Piece[] = [];
  for (const piece of DEP_CANDIDATES) {
    let fits = false;
    for (let rot = 0; rot < ORIENTATIONS[piece].length && !fits; rot++) {
      for (let col = 0; col < COLS; col++) {
        const row = straightDropRow(grid, piece, rot, col);
        if (row === null) continue;
        const pl = { rotation: rot, row, col };
        if (coversCell(piece, pl, r, c) && isCleanFill(grid, piece, pl)) {
          fits = true;
          break;
        }
      }
    }
    if (fits) out.push(piece);
  }
  return out;
}

/**
 * The **single-piece dependencies** of a board (#90): every notch that exactly
 * one piece can hard-drop to fill cleanly (no new hole, no line clear), keyed by
 * which piece. The detector:
 *
 * - **I is reserved** for a 1-wide vertical well of depth ≥ {@link I_WELL_MIN_DEPTH}
 *   whose fill clears no line (a tetris-ready well is NOT a dependency). I never
 *   counts as a filler for any other notch.
 * - **O and T are excluded** as fillers; the candidate set for any non-well
 *   notch is exactly {@link DEP_CANDIDATES} (S/Z/J/L). A notch is a dependency
 *   iff **exactly one** of them fits cleanly — including depth-1 staircases where
 *   S/Z live.
 * - **Edge depth-1 notches** (col 0 / col 9) are ignored as noise; interior
 *   depth-1 staircases are kept. (Edge columns can still hold a deep I-well.)
 *
 * Pure: computed entirely from the board (decoded from a combo entry's
 * `boardKey`) — no engine.
 */
export function singlePieceDependencies(grid: Grid): Dependency[] {
  const h = columnHeights(grid);
  const deps: Dependency[] = [];
  for (let c = 0; c < COLS; c++) {
    if (h[c] >= ROWS) continue; // full column — no landing cell
    const leftH = c > 0 ? h[c - 1] : Infinity; // walls are infinitely tall
    const rightH = c < COLS - 1 ? h[c + 1] : Infinity;
    const notchRow = ROWS - h[c] - 1;

    // I-dependency: a 1-wide well deep enough that only a vertical I fits, whose
    // fill clears no line.
    if (Math.min(leftH, rightH) - h[c] >= I_WELL_MIN_DEPTH) {
      const vert = ORIENTATIONS.I.length - 1;
      const row = straightDropRow(grid, 'I', vert, c);
      if (row !== null && isCleanFill(grid, 'I', { rotation: vert, row, col: c })) {
        deps.push({ piece: 'I', col: c });
      }
      continue; // I reserved — never test S/Z/J/L on a well column
    }

    // Non-well notch: interior only (edge depth-1 notches are noise), and a real
    // recess (lower than at least one neighbour).
    if (c === 0 || c === COLS - 1) continue;
    if (h[c] >= leftH && h[c] >= rightH) continue;
    const fitters = fittersForCell(grid, notchRow, c);
    if (fitters.length === 1) deps.push({ piece: fitters[0], col: c });
  }
  return deps;
}

/** The distinct dependency pieces of a board, as avoid-<piece> tags. */
function avoidTagsFor(grid: Grid): Set<PuzzleTag> {
  const tags = new Set<PuzzleTag>();
  for (const dep of singlePieceDependencies(grid)) {
    const tag = AVOID_DEPENDENCY_TAG[dep.piece];
    if (tag) tags.add(tag);
  }
  return tags;
}

/** Lowest tempting-but-wrong alt score that still earns a trap tag (inclusive). */
export const TRAP_BAND_MIN = 90;
/** Correct-threshold ceiling: an alt at or above this is graded right, not a trap (exclusive). */
export const TRAP_BAND_MAX = 97;
/** Only rank-2 / rank-3 alts can spring the trap. */
export const TRAP_MAX_RANK = 3;

/**
 * The `avoid-<piece>-dependency` contrast tags (#90): emitted when the rank-1
 * outcome is clean (0 single-piece dependencies) but a **tempting near-optimal
 * alternative** — a rank-2/3 combo scoring in [{@link TRAP_BAND_MIN},
 * {@link TRAP_BAND_MAX}) (below the 97 correct-threshold, so graded wrong) —
 * **creates** one or more dependencies. One tag per distinct dependency piece
 * the trap alt creates.
 *
 * Computed entirely from the stored combo table: each entry's `boardKey` decodes
 * to its resulting board. Legacy entries missing a `boardKey` are skipped
 * (consistent with the re-tag path).
 */
function avoidDependencyTags(combos: ComboTable): Set<PuzzleTag> {
  const tags = new Set<PuzzleTag>();
  const rank1 = combos.entries[0];
  if (!rank1 || !rank1.boardKey) return tags;
  // Rank-1 must be clean/flexible.
  if (singlePieceDependencies(decodeBoard(rank1.boardKey)).length > 0) return tags;
  for (let i = 1; i < TRAP_MAX_RANK && i < combos.entries.length; i++) {
    const alt = combos.entries[i];
    if (!alt.boardKey) continue;
    if (alt.score < TRAP_BAND_MIN || alt.score >= TRAP_BAND_MAX) continue;
    for (const tag of avoidTagsFor(decodeBoard(alt.boardKey))) tags.add(tag);
  }
  return tags;
}

/**
 * Tag a puzzle by its optimal / rank-1 line (#81). Reconstructs the rank-1
 * resting line from `rank1` (via {@link restingLineForEntry}, which uses the
 * entry's `boardKey`), replays it, and emits every matching {@link PuzzleTag}.
 * Returns `[]` when nothing matches — or when the line cannot be reconstructed
 * (a legacy entry with no recoverable rows), consistent with the re-tag path.
 *
 * When the full `combos` table is supplied, the `avoid-<piece>-dependency`
 * contrast tags (#90) are also computed — they compare the rank-1 outcome
 * against the rank-2/3 alternatives. Omitting `combos` yields only the
 * rank-1-only tags (backward-compatible).
 */
export function tagPuzzle(
  board: Grid,
  piece1: Piece,
  piece2: Piece,
  rank1: ComboEntry,
  combos?: ComboTable,
): PuzzleTag[] {
  const line = restingLineForEntry(board, piece1, piece2, rank1);
  if (line === null) {
    // The rank-1 line could not be reconstructed, but the contrast tags read
    // only the stored combo outcomes, so they can still be computed.
    return combos ? [...avoidDependencyTags(combos)] : [];
  }
  const { p1, p2 } = line;

  // Replay, tracking lines cleared by each placement and the intermediate board
  // p2 actually rests on (post-clear), so tuck/spin sees the right surface.
  const start = board;
  const a = lockAndClear(start, piece1, p1);
  const board1 = a.board;
  const b = lockAndClear(board1, piece2, p2);
  const after = b.board;
  const linesCleared = a.cleared + b.cleared;
  const holesStart = holes(start);
  const holesAfter = holes(after);

  const tags = new Set<PuzzleTag>();

  // burn / tetris (mutually exclusive by construction).
  if (lineClearsTetris(start, piece1, piece2, p1, p2)) {
    tags.add('tetris');
  } else if (linesCleared >= 1 && linesCleared <= 3) {
    tags.add('burn');
  }

  // tetris-ready: not ready at start, ready after.
  if (!tetrisReady(start) && tetrisReady(after)) tags.add('tetris-ready');

  // tuck / spin / t-spin: a non-hard-drop placement, split by translation-reachability.
  for (const [piece, grid, pl] of [[piece1, start, p1], [piece2, board1, p2]] as const) {
    const m = maneuver(grid, piece, pl);
    if (m === 'tuck') tags.add('tuck');
    else if (m === 'spin') {
      tags.add('spin');
      const spinTag = SPIN_TAG[piece];
      if (spinTag) tags.add(spinTag);
    }
  }

  // clean-stacking: no clears and no new holes.
  if (linesCleared === 0 && holesAfter === holesStart) tags.add('clean-stacking');

  // dig: a line cleared AND holes reduced.
  if (linesCleared >= 1 && holesAfter < holesStart) tags.add('dig');

  // well-maintenance: a single open well at start, still open after.
  const wells = wellColumns(start);
  if (wells.length === 1 && wellColumns(after).includes(wells[0])) {
    tags.add('well-maintenance');
  }

  // avoid-<piece>-dependency contrast tags (#90), when the combo table is given.
  if (combos) for (const tag of avoidDependencyTags(combos)) tags.add(tag);

  return [...tags];
}
