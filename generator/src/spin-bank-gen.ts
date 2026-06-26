/**
 * Insert engine-agreed forced T-spin puzzles into the live bank.
 *
 * Constructs varied forced-T-spin-double boards (spin-seed-gen), runs each
 * through the FULL production pipeline — assemblePuzzle (StackRabbit combo sweep
 * + #50/#53 quality gates → real combos table, optimal line, tags, difficulty
 * seed) — keeps only those whose stored optimal is the spin, dedups vs the live
 * bank, then gates on the BetaTetris 7/7 consensus and inserts the survivors.
 *
 * Reuses filterByConsensus with a Windows-safe judge (spawns consensus.py with
 * the BT env directly, not the bt-run.cmd shell). Creds from repo-root .env;
 * StackRabbit must be running.
 *
 *   npx tsx generator/src/spin-bank-gen.ts [--count N] [--dry-run]
 */
import {
  cloneBoard,
  emptyColorGrid,
  type ColorGrid,
  type Grid,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { isNaturalBoard } from './board-natural.js';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { filterByConsensus } from './pipeline/consensus.js';
import { isNearDuplicate, type BankKey } from './pipeline/dedup.js';
import { loadRepoEnv, createBetaTetrisJudge, createManagedStackRabbit, loadActiveBankKeys } from './gen-harness.js';
import { constructTSpinDouble, coreVerify } from './spin-seed-gen.js';
import type { Candidate } from './selfplay/board-source.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 24;
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

const judge = createBetaTetrisJudge('spin');

async function main() {
  const { engine, ensureEngine } = createManagedStackRabbit();
  if (!(await ensureEngine())) throw new Error('StackRabbit not reachable at :3000');
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);

  // existing ACTIVE bank keys for dedup (paginated)
  const existingKeys = await loadActiveBankKeys(client);
  console.log(`loaded ${existingKeys.length} active bank keys for dedup; target ${target} spins${dryRun ? ' (dry-run)' : ''}`);

  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: 'X.....',
    maxHoles: 2,
    maxBumpiness: 20,
    varietyLane: { maxHoles: 2, maxBumpiness: 26, fraction: 1.0 },
  };

  const survivors: NewPuzzle[] = [];
  const acceptedKeys = [...existingKeys];
  const perCol = new Map<number, number>();
  const rejections: Record<string, number> = {};
  let constructed = 0;
  while (survivors.length < target && constructed < target * 60) {
    const con = constructTSpinDouble();
    if (!con) continue;
    const v = coreVerify(con);
    if (!v) continue;
    if ((perCol.get(v.slotCol) ?? 0) >= PER_COL_CAP) continue;
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
    if (!(result.puzzle.tags ?? []).includes('spin')) { rejections['optimal-not-spin'] = (rejections['optimal-not-spin'] ?? 0) + 1; continue; }
    const dupKey: BankKey = { board: con.board, piece1: con.piece1, piece2: con.piece2 };
    if (isNearDuplicate(dupKey, acceptedKeys, config.dedupMaxHamming)) { rejections['duplicate'] = (rejections['duplicate'] ?? 0) + 1; continue; }
    acceptedKeys.push(dupKey);
    perCol.set(v.slotCol, (perCol.get(v.slotCol) ?? 0) + 1);
    survivors.push(result.puzzle);
  }
  console.log(`assembled ${survivors.length} spin puzzles from ${constructed} constructions`);
  console.log(`rejections:`, rejections);

  // BetaTetris 7/7 consensus
  const consensus = await filterByConsensus(survivors, judge, { existing: existingKeys, maxHamming: config.dedupMaxHamming });
  console.log(`\nBetaTetris consensus: kept ${consensus.kept.length}/${survivors.length} (rate ${(consensus.keepRate * 100).toFixed(0)}%, bt-errors ${consensus.btErrors})`);
  const dropReasons: Record<string, number> = {};
  for (const d of consensus.dropped) dropReasons[d.reason] = (dropReasons[d.reason] ?? 0) + 1;
  if (consensus.dropped.length) console.log(`  dropped:`, dropReasons);

  const kept = consensus.kept;
  const tagsOf = (p: { tags?: readonly string[] | null }) => (p.tags ?? []).filter((t) => t.endsWith('-spin') || t === 'spin').join('+');
  if (dryRun) {
    console.log(`\n--dry-run: would insert ${kept.length} engine-agreed spin puzzles:`);
    for (const p of kept) console.log(`  ${p.piece1}+${p.piece2} [${(p.tags ?? []).join(',')}]`);
  } else if (kept.length) {
    const stored = await db.insertPuzzles(kept);
    console.log(`\ninserted ${stored.length} spin puzzles:`);
    for (const p of stored) console.log(`  #${p.number} ${p.piece1}+${p.piece2} (${tagsOf(p)})`);
  } else {
    console.log(`\nnothing to insert`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
