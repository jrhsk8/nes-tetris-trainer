/**
 * Varied-board tuck / spin generator (#94 follow-up) — produces engine-agreed
 * tuck and spin puzzles on DIVERSE boards, fixing the near-duplicate repetition a
 * bank-dedup audit surfaced (the S/Z dig batch and the multi-pair tuck batches all
 * reused near-identical boards).
 *
 * Two changes vs the earlier per-type generators:
 *  1. **Varied board source** — random height, surface roughness, pocket count and
 *     positions (any side), and an optional well — instead of one fixed template.
 *  2. **In-batch board-distance dedup** — a new puzzle is rejected if its board is
 *     within `BATCH_MIN_HAMMING` cells of any already-accepted board (regardless of
 *     pieces), so the batch itself is diverse, not just deduped against the bank.
 *
 * The maneuver is found via the DIG insight that made S/Z spins work: a reachable
 * tuck OR spin (any piece) that clears a line AND reduces holes — StackRabbit ranks
 * digs #1. One puzzle per board (no multi-pair), the S/Z/T/J/L/I piece spins-or-tucks
 * as piece 1, O follows. Strict bar unchanged: StackRabbit rank-1 (tuck/spin tag) +
 * interactive reachability + BetaTetris 7/7 consensus.
 *
 *   npx tsx generator/src/varied-maneuver-gen.ts [--count N] [--dry-run]
 */
import {
  emptyBoard,
  cloneBoard,
  decodeBoard,
  emptyColorGrid,
  applyRestingPlacement,
  inputReachableRestingPlacements,
  maneuver,
  boardMetrics,
  restingLineForEntry,
  isInputReachable,
  PIECES,
  type Grid,
  type Piece,
  type RestingPlacement,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { isNaturalBoard } from './board-natural.js';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { finishWithConsensus } from './pipeline/bank-insert.js';
import { isNearDuplicate, boardHamming } from './pipeline/dedup.js';
import { loadRepoEnv, createBetaTetrisJudge, createManagedStackRabbit, loadActiveBankKeys } from './gen-harness.js';
import type { Candidate } from './selfplay/board-source.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 24;
/** Reject a candidate whose board is within this many cells of any accepted board. */
const BATCH_MIN_HAMMING = 12;

loadRepoEnv();
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

const R = (n: number) => Math.floor(Math.random() * n);
const cc = (b: Grid) => b.reduce((n, r) => n + r.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
const fr = (b: Grid) => b.filter((r) => r.every((c) => c)).length;

/** A diverse nearly-clean board: varied height, roughness, pockets (any side), optional well. */
function variedBoard(): Grid {
  const b = emptyBoard();
  const base = 11 + R(6); // surface row 11..16; variety from pocket POSITION/side/count.
  const rough = R(3);
  const h: number[] = [];
  for (let c = 0; c < 10; c++) h[c] = Math.max(4, Math.min(19, base + R(rough + 1) - R(rough + 1)));
  for (let c = 0; c < 10; c++) for (let r = 19; r >= h[c]; r--) b[r][c] = 1;
  const np = 1 + R(3);
  for (let k = 0; k < np; k++) {
    const c = R(10);
    const r = h[c] + R(3);
    if (r >= 0 && r <= 19) {
      b[r][c] = 0;
      if (R(2) && r + 1 <= 19) b[r + 1][c] = 0;
    }
  }
  if (R(2)) {
    const wc = R(10);
    const d = 2 + R(4);
    for (let r = 19; r > Math.max(0, 19 - d); r--) b[r][wc] = 0;
  }
  return b;
}

/** Find a reachable DIG maneuver (tuck or spin) on `b`: clears ≥1 line and reduces holes. */
function findDigManeuver(b: Grid): { piece1: Piece; placement: RestingPlacement; kind: 'tuck' | 'spin' } | null {
  const h0 = boardMetrics(b).holes;
  const order = [...PIECES].sort(() => Math.random() - 0.5);
  for (const piece1 of order) {
    for (const pl of inputReachableRestingPlacements(b, piece1)) {
      const mv = maneuver(b, piece1, pl);
      if (mv !== 'tuck' && mv !== 'spin') continue;
      const after = applyRestingPlacement(b, piece1, pl);
      if ((cc(b) + 4 - cc(after)) / 10 < 1) continue; // must clear
      if (boardMetrics(after).holes >= h0) continue; // must dig (reduce holes)
      return { piece1, placement: pl, kind: mv };
    }
  }
  return null;
}

function syntheticColors(board: Grid) {
  const colors = emptyColorGrid();
  for (let r = 0; r < board.length; r++)
    for (let c = 0; c < board[r].length; c++)
      if (board[r][c]) colors[r][c] = (((r * 7 + c * 3) % 3) + 1) as 1 | 2 | 3;
  return colors;
}

const judge = createBetaTetrisJudge('varied');

/** The stored optimal must perform a reachable tuck/spin on piece 1. */
function optimalIsReachableManeuver(p: NewPuzzle): boolean {
  const entry = p.combos?.entries?.[0];
  if (!entry) return false;
  const board0 = decodeBoard(p.board);
  const line = restingLineForEntry(board0, p.piece1, p.piece2, entry);
  if (!line) return false;
  const m1 = maneuver(board0, p.piece1, line.p1);
  if (m1 !== 'tuck' && m1 !== 'spin') return false;
  return isInputReachable(board0, p.piece1, line.p1);
}

async function main(): Promise<void> {
  const { engine, ensureEngine } = createManagedStackRabbit();
  if (!(await ensureEngine())) throw new Error('StackRabbit not reachable at :3000');
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);
  const existingKeys = await loadActiveBankKeys(client);
  const existingBoards = existingKeys.map((k) => k.board);
  console.log(`loaded ${existingKeys.length} active bank keys; target ${target} varied tuck/spin${dryRun ? ' (dry-run)' : ''}`);
  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: 'X.....',
    maxHoles: 6,
    maxBumpiness: 44,
    varietyLane: { maxHoles: 6, maxBumpiness: 44, fraction: 1.0 },
  };
  const survivors: NewPuzzle[] = [];
  const acceptedBoards: Grid[] = [];
  const rejections: Record<string, number> = {};
  let constructed = 0;
  const cap = target * 600;
  while (survivors.length < target && constructed < cap) {
    const board = variedBoard();
    if (fr(board) > 0 || cc(board) % 2 !== 0) continue;
    const h0 = boardMetrics(board).holes;
    if (h0 < 1 || h0 > 6) continue;
    const man = findDigManeuver(board);
    if (!man) continue;
    constructed++;
    if (!isNaturalBoard(board)) { rejections['unnatural-board'] = (rejections['unnatural-board'] ?? 0) + 1; continue; }
    // In-batch variety: reject boards too close to one already accepted (any pieces).
    if (acceptedBoards.some((ab) => boardHamming(ab, board) <= BATCH_MIN_HAMMING)) { rejections['batch-near-dup'] = (rejections['batch-near-dup'] ?? 0) + 1; continue; }
    // Bank dedup (same pieces, the production criterion).
    if (isNearDuplicate({ piece1: man.piece1, piece2: 'O', board }, existingKeys, config.dedupMaxHamming)) { rejections['bank-dup'] = (rejections['bank-dup'] ?? 0) + 1; continue; }
    // Bank look-alike: skip if the board nearly matches any bank board regardless of pieces.
    if (existingBoards.some((eb) => boardHamming(eb, board) <= 4)) { rejections['bank-lookalike'] = (rejections['bank-lookalike'] ?? 0) + 1; continue; }

    const candidate: Candidate = { board: cloneBoard(board), colors: syntheticColors(board), currentPiece: man.piece1, nextPiece: 'O', level: 18, lines: 0 };
    let result;
    try {
      result = await assemblePuzzle(engine, candidate, config);
    } catch {
      rejections['engine-error'] = (rejections['engine-error'] ?? 0) + 1;
      await ensureEngine();
      continue;
    }
    if (!result.ok) { rejections[result.reason] = (rejections[result.reason] ?? 0) + 1; continue; }
    const tags = result.puzzle.tags ?? [];
    if (!tags.some((t) => t === 'tuck' || t === 'spin')) { rejections['optimal-not-maneuver'] = (rejections['optimal-not-maneuver'] ?? 0) + 1; continue; }
    if (!optimalIsReachableManeuver(result.puzzle)) { rejections['not-reachable'] = (rejections['not-reachable'] ?? 0) + 1; continue; }
    acceptedBoards.push(board);
    survivors.push(result.puzzle);
  }
  console.log(`assembled ${survivors.length} varied tuck/spin puzzles from ${constructed} constructions`);
  console.log('rejections:', rejections);
  await finishWithConsensus(survivors, {
    judge,
    existingKeys,
    maxHamming: config.dedupMaxHamming,
    db,
    dryRun,
    label: 'varied tuck/spin puzzles',
    describe: (p) => (p.tags ?? []).filter((t) => t === 'tuck' || t === 'spin' || t.endsWith('-spin')).join('+'),
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
