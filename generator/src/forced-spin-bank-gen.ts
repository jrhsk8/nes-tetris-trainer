/**
 * Insert engine-agreed per-piece forced-spin puzzles into the live bank (#94).
 *
 * Generalizes {@link spin-bank-gen} (T-spin only) to J-spin and L-spin — the
 * pieces whose spin can be forced into a clean line clear (S/Z cannot; their line
 * maneuver is a tuck). For each constructed forced spin ({@link constructForcedSpin})
 * it runs the FULL production pipeline (assemblePuzzle → real combos, optimal line,
 * tags, difficulty), then keeps a puzzle only if ALL of:
 *
 *   1. the stored optimal carries the per-piece spin tag (the spin IS rank-1),
 *   2. the optimal spinning ply is **interactively reachable** under the
 *      descending-spin input law (#91) — the generator↔play gate,
 *   3. it is not a near-duplicate of the live bank,
 *   4. it passes the BetaTetris 7/7 consensus.
 *
 * Survivors insert directly ACTIVE (cull later via the in-play admin tools).
 * Creds from repo-root .env; StackRabbit must be running.
 *
 *   npx tsx generator/src/forced-spin-bank-gen.ts [--count N] [--pieces J,L] [--dry-run]
 */
import {
  cloneBoard,
  decodeBoard,
  emptyColorGrid,
  isInputReachable,
  lockAndClear,
  maneuver,
  restingLineForEntry,
  SPIN_TAG,
  type ColorGrid,
  type Grid,
  type Piece,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { isNaturalBoard } from './board-natural.js';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { finishWithConsensus } from './pipeline/bank-insert.js';
import { isNearDuplicate, type BankKey } from './pipeline/dedup.js';
import { loadRepoEnv, createBetaTetrisJudge, createManagedStackRabbit, loadActiveBankKeys } from './gen-harness.js';
import { constructForcedSpin, FORCED_SPIN_PIECES } from './forced-spin.js';
import type { Candidate } from './selfplay/board-source.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 24;
const piecesArg = args.indexOf('--pieces') >= 0 ? args[args.indexOf('--pieces') + 1] : 'J,L';
const pieces = piecesArg.split(',').map((p) => p.trim().toUpperCase() as Piece).filter((p) => FORCED_SPIN_PIECES.includes(p));
if (!pieces.length) throw new Error(`--pieces must be a subset of ${FORCED_SPIN_PIECES.join(',')}`);
const PER_COL_CAP = 4;

loadRepoEnv();
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

/** Synthetic NES-ish colours for a binary board (display only). */
function syntheticColors(board: Grid): ColorGrid {
  const colors = emptyColorGrid();
  for (let r = 0; r < board.length; r++)
    for (let c = 0; c < board[r].length; c++)
      if (board[r][c]) colors[r][c] = (((r * 7 + c * 3) % 3) + 1) as 1 | 2 | 3;
  return colors;
}

const judge = createBetaTetrisJudge('fspin');

/**
 * Confirm the puzzle's stored optimal line actually performs the forced spin on
 * the named piece AND that that spinning ply is interactively reachable (#91/#94).
 * Reconstructs the rank-1 line from the stored combo (the same path the tagger and
 * play replay use). Returns false for legacy/unrecoverable combos.
 */
function optimalSpinIsReachable(puzzle: NewPuzzle, piece2: Piece): boolean {
  const entry = puzzle.combos?.entries?.[0];
  if (!entry) return false;
  const board0 = decodeBoard(puzzle.board);
  const line = restingLineForEntry(board0, puzzle.piece1, puzzle.piece2, entry);
  if (!line) return false;
  const board1 = lockAndClear(board0, puzzle.piece1, line.p1).board;
  // The spin must be piece 2 (the constructed maneuver), reachable and classified spin.
  return maneuver(board1, piece2, line.p2) === 'spin' && isInputReachable(board1, piece2, line.p2);
}

async function main(): Promise<void> {
  const { engine, ensureEngine } = createManagedStackRabbit();
  if (!(await ensureEngine())) throw new Error('StackRabbit not reachable at :3000');
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);

  // Existing ACTIVE bank keys for dedup (paginated).
  const existingKeys = await loadActiveBankKeys(client);
  console.log(`loaded ${existingKeys.length} active bank keys for dedup; target ${target} spins over [${pieces.join(',')}]${dryRun ? ' (dry-run)' : ''}`);

  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: 'X.....',
    maxHoles: 2,
    maxBumpiness: 20,
    varietyLane: { maxHoles: 2, maxBumpiness: 26, fraction: 1.0 },
  };

  const survivors: NewPuzzle[] = [];
  const acceptedKeys = [...existingKeys];
  const perCol = new Map<string, number>();
  const rejections: Record<string, number> = {};
  let constructed = 0;
  const cap = target * 80;
  while (survivors.length < target && constructed < cap) {
    const piece2 = pieces[constructed % pieces.length];
    const con = constructForcedSpin(piece2);
    if (!con) continue;
    const colKey = `${piece2}:${con.slotCol}`;
    if ((perCol.get(colKey) ?? 0) >= PER_COL_CAP) continue;
    constructed++;
    if (!isNaturalBoard(con.board)) { rejections['unnatural-board'] = (rejections['unnatural-board'] ?? 0) + 1; continue; }
    const candidate: Candidate = {
      board: cloneBoard(con.board),
      colors: syntheticColors(con.board),
      currentPiece: con.piece1,
      nextPiece: con.piece2,
      level: 18,
      lines: 0,
    };
    let result;
    try {
      result = await assemblePuzzle(engine, candidate, config);
    } catch {
      rejections['engine-error'] = (rejections['engine-error'] ?? 0) + 1;
      await ensureEngine();
      continue;
    }
    if (!result.ok) { rejections[result.reason] = (rejections[result.reason] ?? 0) + 1; continue; }
    const spinTag = SPIN_TAG[piece2];
    if (!spinTag || !(result.puzzle.tags ?? []).includes(spinTag)) { rejections['optimal-not-this-spin'] = (rejections['optimal-not-this-spin'] ?? 0) + 1; continue; }
    if (!optimalSpinIsReachable(result.puzzle, piece2)) { rejections['not-input-reachable'] = (rejections['not-input-reachable'] ?? 0) + 1; continue; }
    const dupKey: BankKey = { board: con.board, piece1: con.piece1, piece2: con.piece2 };
    if (isNearDuplicate(dupKey, acceptedKeys, config.dedupMaxHamming)) { rejections['duplicate'] = (rejections['duplicate'] ?? 0) + 1; continue; }
    acceptedKeys.push(dupKey);
    perCol.set(colKey, (perCol.get(colKey) ?? 0) + 1);
    survivors.push(result.puzzle);
  }
  console.log(`assembled ${survivors.length} forced-spin puzzles from ${constructed} constructions`);
  console.log(`rejections:`, rejections);

  // BetaTetris 7/7 consensus + insert (the shared generator tail).
  await finishWithConsensus(survivors, {
    judge,
    existingKeys,
    maxHamming: config.dedupMaxHamming,
    db,
    dryRun,
    label: 'forced-spin puzzles',
    describe: (p) => (p.tags ?? []).filter((t) => t.endsWith('-spin') || t === 'spin').join('+'),
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
