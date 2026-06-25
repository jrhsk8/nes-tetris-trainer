/**
 * Tuck & spin puzzle generator — creates puzzles where a tuck or spin by any
 * piece (S, Z, J, T, L, I) is genuinely the best play, using board metrics
 * (holes + height) as a value proxy. No StackRabbit needed.
 *
 * Approach:
 * 1. For each target piece, generate boards with pockets matching that piece's
 *    shape (spins) or overhangs (tucks)
 * 2. Sweep all two-piece combos, ranking by a holes + height metric
 * 3. Keep boards where a tuck/spin combo IS metric-best (rank-1)
 * 4. Build proper combo tables and insert into the bank
 *
 * Run:
 *   NODE_OPTIONS="--experimental-websocket" npx tsx generator/src/spin-gen.ts [--dry-run] [--count N]
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (write access).
 */

import { pathToFileURL } from 'node:url';
import {
  ROWS,
  COLS,
  ORIENTATIONS,
  emptyBoard,
  encodeBoard,
  encodeColors,
  emptyColorGrid,
  applyRestingPlacement,
  boardKey,
  boardMetrics,
  enumerateResting,
  maneuver,
  tagPuzzle,
  type Grid,
  type Piece,
  type RestingPlacement,
} from '@trainer/core';
import type { ComboEntry, ComboTable } from '@trainer/core';
import { createSupabaseClient, createDataAccess } from '@trainer/data';
import type { NewPuzzle } from '@trainer/data';
import { seedRatingFor, difficultyFromScores, bandFor } from './pipeline/difficulty.js';

/** The pieces we seek maneuver puzzles for (O excluded — 1 rotation, can't spin). */
const MANEUVER_PIECES: readonly Piece[] = ['T', 'S', 'Z', 'J', 'L', 'I'];

/** All pieces that can appear as piece2. */
const ALL_PIECE2: readonly Piece[] = ['I', 'O', 'S', 'Z', 'J', 'L', 'T'];

type ManeuverKind = 'tuck' | 'spin';

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(lo: number, hi: number, rng: () => number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---------------------------------------------------------------------------
// Board generators
// ---------------------------------------------------------------------------

/** Random mid-game topography with varied heights and carved pockets. */
function randomBoard(rng: () => number): Grid {
  const grid = emptyBoard();
  const baseHeight = randInt(3, 7, rng);
  const heights: number[] = [];
  for (let c = 0; c < COLS; c++) {
    heights[c] = Math.max(1, baseHeight + randInt(-2, 3, rng));
  }
  for (let c = 0; c < COLS; c++) {
    for (let h = 0; h < heights[c]; h++) {
      const row = ROWS - 1 - h;
      if (row >= 0) grid[row][c] = 1;
    }
  }
  // Carve pockets
  const pocketCount = randInt(1, 4, rng);
  for (let i = 0; i < pocketCount; i++) {
    const col = randInt(0, COLS - 1, rng);
    const minRow = ROWS - heights[col];
    if (minRow < ROWS - 1) {
      const pocketRow = minRow + randInt(0, Math.min(2, ROWS - minRow - 2), rng);
      if (pocketRow < ROWS) grid[pocketRow][col] = 0;
    }
  }
  return grid;
}

/**
 * Board with an overhang specifically creating a tuck opportunity for `piece`.
 * Builds a platform, then extends one column higher to create an overhang the
 * piece can slide under.
 */
function tuckBoard(piece: Piece, rng: () => number): Grid {
  const grid = emptyBoard();
  const baseHeight = randInt(3, 6, rng);
  const heights: number[] = [];
  for (let c = 0; c < COLS; c++) {
    heights[c] = Math.max(1, baseHeight + randInt(-1, 2, rng));
  }

  // Pick a column range for the overhang
  const rot = randInt(0, ORIENTATIONS[piece].length - 1, rng);
  const shape = ORIENTATIONS[piece][rot];
  const pieceWidth = Math.max(...shape.map(([, c]) => c)) + 1;
  const tuckCol = randInt(0, COLS - pieceWidth, rng);

  // Create an overhang: one neighbouring column extends higher
  const overhangSide = tuckCol > 0 && (tuckCol + pieceWidth >= COLS || rng() < 0.5) ? -1 : 1;
  const overhangCol = tuckCol + (overhangSide > 0 ? pieceWidth : -1);
  if (overhangCol >= 0 && overhangCol < COLS) {
    heights[overhangCol] = Math.max(heights[overhangCol], baseHeight + randInt(2, 4, rng));
  }

  // Fill
  for (let c = 0; c < COLS; c++) {
    for (let h = 0; h < heights[c]; h++) {
      const row = ROWS - 1 - h;
      if (row >= 0) grid[row][c] = 1;
    }
  }

  // Add some random variation
  for (let c = 0; c < COLS; c++) {
    if (rng() < 0.3) {
      const carveRow = ROWS - heights[c];
      if (carveRow >= 0 && carveRow < ROWS) grid[carveRow][c] = 0;
    }
  }

  return grid;
}

/**
 * Board with a pocket shaped for a specific piece rotation — the piece must
 * spin into the pocket (rotate at depth). Builds a solid platform, carves a
 * piece-shaped cavity, then adds overhangs above to block hard-drop access.
 */
function spinBoard(piece: Piece, rng: () => number): Grid {
  const grid = emptyBoard();
  const rot = randInt(0, ORIENTATIONS[piece].length - 1, rng);
  const shape = ORIENTATIONS[piece][rot];
  const pieceHeight = Math.max(...shape.map(([r]) => r)) + 1;
  const pieceWidth = Math.max(...shape.map(([, c]) => c)) + 1;

  // Pick where the pocket goes
  const pocketCol = randInt(1, COLS - pieceWidth - 1, rng);
  const baseTop = randInt(13, 17 - pieceHeight, rng);

  // Build a solid platform from baseTop down
  for (let r = baseTop; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[r][c] = 1;
    }
  }

  // Carve the piece-shaped pocket
  const pocketRow = baseTop + randInt(1, Math.max(1, ROWS - baseTop - pieceHeight - 1), rng);
  for (const [dr, dc] of shape) {
    const r = pocketRow + dr;
    const c = pocketCol + dc;
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      grid[r][c] = 0;
    }
  }

  // Ensure overhangs above the pocket cells to block hard-drop
  for (const [dr, dc] of shape) {
    const r = pocketRow + dr;
    const c = pocketCol + dc;
    if (r >= 1 && c >= 0 && c < COLS) {
      for (let aboveR = baseTop; aboveR < r; aboveR++) {
        grid[aboveR][c] = 1;
      }
    }
  }

  // Ensure entry path: at least one column above baseTop is clear so the
  // piece can enter from the top and manoeuvre in
  const entryCols = new Set<number>();
  for (const [, dc] of shape) entryCols.add(pocketCol + dc);
  // Pick one column near the pocket that's open above the platform
  const entryCol = randInt(
    Math.max(0, pocketCol - 2),
    Math.min(COLS - 1, pocketCol + pieceWidth + 1),
    rng,
  );
  for (let r = 0; r < baseTop; r++) grid[r][entryCol] = 0;
  // Also clear the space above baseTop generally
  for (let r = 0; r < baseTop; r++) {
    for (let c = 0; c < COLS; c++) grid[r][c] = 0;
  }

  // Add random stacking variation to the surface
  for (let c = 0; c < COLS; c++) {
    const extra = randInt(0, 3, rng);
    for (let h = 0; h < extra; h++) {
      const r = baseTop - 1 - h;
      if (r >= 0) grid[r][c] = 1;
    }
  }

  return grid;
}

// ---------------------------------------------------------------------------
// Metric-based combo scoring
// ---------------------------------------------------------------------------

interface MetricCombo {
  p1: RestingPlacement;
  p2: RestingPlacement;
  board2: Grid;
  key: string;
  metricValue: number;
  m1: 'hard-drop' | 'tuck' | 'spin';
  m2: 'hard-drop' | 'tuck' | 'spin';
}

function metricValue(grid: Grid): number {
  const m = boardMetrics(grid);
  const maxH = m.columnHeights.length ? Math.max(...m.columnHeights) : 0;
  return -(m.holes * 100 + maxH * 2 + m.aggregateHeight * 0.5 + m.bumpiness * 0.3);
}

const SCORE_SLOPE = 0.625;

function normalizeScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const best = values[0];
  return values.map((v) => Math.max(0, Math.min(100, 100 - SCORE_SLOPE * (best - v))));
}

function sweepByMetrics(board: Grid, piece1: Piece, piece2: Piece): MetricCombo[] {
  const byOutcome = new Map<string, MetricCombo>();

  for (const p1 of enumerateResting(board, piece1)) {
    const board1 = applyRestingPlacement(board, piece1, p1);
    const m1 = maneuver(board, piece1, p1);
    for (const p2 of enumerateResting(board1, piece2)) {
      const board2 = applyRestingPlacement(board1, piece2, p2);
      const m2 = maneuver(board1, piece2, p2);
      const key = boardKey(board2);
      const value = metricValue(board2);
      const existing = byOutcome.get(key);
      if (!existing || value > existing.metricValue) {
        byOutcome.set(key, { p1, p2, board2, key, metricValue: value, m1, m2 });
      }
    }
  }

  const combos = [...byOutcome.values()];
  combos.sort((a, b) => b.metricValue - a.metricValue);
  return combos;
}

// ---------------------------------------------------------------------------
// Puzzle assembly (generalized for any piece + any maneuver)
// ---------------------------------------------------------------------------

const TOP_K = 30;

interface AssembleOpts {
  targetPiece: Piece;
  wantManeuver: ManeuverKind;
}

function assemblePuzzle(
  board: Grid,
  piece1: Piece,
  piece2: Piece,
  combos: MetricCombo[],
  opts: AssembleOpts,
): NewPuzzle | null {
  if (combos.length < 2) return null;

  const best = combos[0];

  // Verify the best combo involves the desired maneuver by the target piece
  const p1Match = piece1 === opts.targetPiece && best.m1 === opts.wantManeuver;
  const p2Match = piece2 === opts.targetPiece && best.m2 === opts.wantManeuver;
  if (!p1Match && !p2Match) return null;

  // Board quality
  const startMetrics = boardMetrics(board);
  if (Math.max(...startMetrics.columnHeights) > 14) return null;
  if (startMetrics.holes > 4) return null;

  // Build the combo table
  const values = combos.map((c) => c.metricValue);
  const scores = normalizeScores(values);

  const entries: ComboEntry[] = combos.slice(0, TOP_K).map((c, i) => ({
    rot1: c.p1.rotation,
    col1: c.p1.col,
    rot2: c.p2.rotation,
    col2: c.p2.col,
    score: scores[i],
    boardKey: c.key,
  }));

  const table: ComboTable = { entries, total: combos.length };
  const tags = tagPuzzle(board, piece1, piece2, entries[0], table);

  // Verify the expected tag is present
  if (!tags.includes(opts.wantManeuver)) return null;

  const difficulty = difficultyFromScores(scores);
  const seed = seedRatingFor(difficulty, { tetris: false });

  return {
    board: encodeBoard(board),
    piece1,
    piece2,
    optimalLine: [
      { rotation: best.p1.rotation, col: best.p1.col },
      { rotation: best.p2.rotation, col: best.p2.col },
    ],
    optimalMetrics: boardMetrics(best.board2),
    colors: encodeColors(emptyColorGrid()),
    combos: table,
    tags,
    acceptCount: difficulty.acceptCount,
    margin: difficulty.margin,
    glicko: { rating: seed },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Quota {
  piece: Piece;
  maneuver: ManeuverKind;
  target: number;
  found: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const countIdx = process.argv.indexOf('--count');
  const perSlot = countIdx >= 0 ? parseInt(process.argv[countIdx + 1], 10) : 5;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL + service key required');

  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);

  // Build quotas: N tucks + N spins per piece type
  const quotas: Quota[] = [];
  for (const piece of MANEUVER_PIECES) {
    quotas.push({ piece, maneuver: 'tuck', target: perSlot, found: 0 });
    // O can't spin (1 rotation); I has 2 rotations but spins are rare — still try
    quotas.push({ piece, maneuver: 'spin', target: perSlot, found: 0 });
  }

  const totalTarget = quotas.reduce((s, q) => s + q.target, 0);
  const puzzles: NewPuzzle[] = [];
  const seenBoards = new Set<string>();
  let boardsTried = 0;
  const maxBoards = 2_000_000;
  const rng = mulberry32(777);

  console.log(
    `generating ${perSlot} tuck + ${perSlot} spin per piece (${MANEUVER_PIECES.join(',')})` +
      ` = ${totalTarget} total${dryRun ? ' (dry run)' : ''}…\n`,
  );

  const allDone = () => quotas.every((q) => q.found >= q.target);

  while (!allDone() && boardsTried < maxBoards) {
    boardsTried++;

    // Pick a random unfilled quota to seek
    const open = quotas.filter((q) => q.found < q.target);
    if (open.length === 0) break;
    const q = pick(open, rng);

    // Generate a board suited to the target
    let board: Grid;
    const r = rng();
    if (q.maneuver === 'spin') {
      board = r < 0.25 ? randomBoard(rng) : spinBoard(q.piece, rng);
    } else {
      board = r < 0.3 ? randomBoard(rng) : tuckBoard(q.piece, rng);
    }

    const boardStr = encodeBoard(board);
    if (seenBoards.has(boardStr)) continue;
    seenBoards.add(boardStr);

    // Quick check: does the target piece have any maneuver placement?
    const restings = enumerateResting(board, q.piece);
    const hasManeuver = restings.some((p) => maneuver(board, q.piece, p) === q.maneuver);
    if (!hasManeuver) continue;

    // Try the target piece as piece1, with various piece2 options
    const piece2Candidates = [...ALL_PIECE2];
    // Shuffle so we don't always pick the same piece2
    for (let i = piece2Candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [piece2Candidates[i], piece2Candidates[j]] = [piece2Candidates[j], piece2Candidates[i]];
    }

    let found = false;

    // Try target piece as piece1
    for (const p2 of piece2Candidates) {
      if (found) break;
      const combos = sweepByMetrics(board, q.piece, p2);
      const puzzle = assemblePuzzle(board, q.piece, p2, combos, {
        targetPiece: q.piece,
        wantManeuver: q.maneuver,
      });
      if (puzzle) {
        puzzles.push(puzzle);
        q.found++;
        found = true;
        console.log(
          `  ${q.piece}-${q.maneuver} #${q.found}/${q.target}: ` +
            `${q.piece}(${q.maneuver})+${p2} tags=[${puzzle.tags?.join(', ')}] ` +
            `band=${bandFor(puzzle.acceptCount ?? 0, { tetris: false })} ` +
            `(${boardsTried} boards)`,
        );
      }
    }
    if (found) continue;

    // Also try target piece as piece2 (another piece goes first, target piece
    // does the maneuver on the resulting board)
    for (const p1 of piece2Candidates) {
      if (found) break;
      if (p1 === q.piece) continue; // already tried as piece1
      const combos = sweepByMetrics(board, p1, q.piece);
      const puzzle = assemblePuzzle(board, p1, q.piece, combos, {
        targetPiece: q.piece,
        wantManeuver: q.maneuver,
      });
      if (puzzle) {
        puzzles.push(puzzle);
        q.found++;
        found = true;
        console.log(
          `  ${q.piece}-${q.maneuver} #${q.found}/${q.target}: ` +
            `${p1}+${q.piece}(${q.maneuver}) tags=[${puzzle.tags?.join(', ')}] ` +
            `band=${bandFor(puzzle.acceptCount ?? 0, { tetris: false })} ` +
            `(${boardsTried} boards)`,
        );
      }
    }
  }

  // Report
  console.log(`\n--- results after ${boardsTried} boards ---`);
  for (const q of quotas) {
    const status = q.found >= q.target ? 'DONE' : `${q.found}/${q.target}`;
    console.log(`  ${q.piece}-${q.maneuver}: ${status}`);
  }
  console.log(`total puzzles: ${puzzles.length}`);

  if (puzzles.length === 0) {
    console.log('no puzzles found');
    return;
  }

  if (!dryRun) {
    const stored = await db.insertPuzzles(puzzles);
    console.log(`\ninserted ${stored.length} puzzles into the bank`);
    for (const p of stored) {
      console.log(`  #${p.number} ${p.piece1}+${p.piece2} tags=[${p.tags.join(', ')}]`);
    }
  } else {
    console.log('\n(dry run — no puzzles inserted)');
    for (const p of puzzles) {
      console.log(`  ${p.piece1}+${p.piece2} tags=[${p.tags?.join(', ')}]`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
