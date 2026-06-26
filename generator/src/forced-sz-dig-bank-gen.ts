/**
 * Insert engine-agreed S-spin / Z-spin DIG puzzles into the live bank (#94).
 *
 * The breakthrough for S/Z (which never rank #1 as clean clears): make the spin a
 * **dig** — on a nearly-clean board it clears a line AND reduces holes, which
 * StackRabbit values just like the accepted t-spin digs (#2443/#2444). The S/Z is
 * piece 1 and spins into a right-side pocket/well; piece 2 (O) follows. Strict bar,
 * unchanged: StackRabbit rank-1 (spin tag) + interactive reachability + BetaTetris
 * 7/7 consensus.
 *
 *   npx tsx generator/src/forced-sz-dig-bank-gen.ts [--count N] [--dry-run]
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
  type Grid,
  type Piece,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { isNaturalBoard } from './board-natural.js';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { filterByConsensus } from './pipeline/consensus.js';
import { isNearDuplicate, type BankKey } from './pipeline/dedup.js';
import { loadRepoEnv, createBetaTetrisJudge, createManagedStackRabbit, loadActiveBankKeys } from './gen-harness.js';
import type { Candidate } from './selfplay/board-source.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 20;
loadRepoEnv();
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

const cc = (b: Grid): number => b.reduce((n, r) => n + r.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
const fr = (b: Grid): number => b.filter((r) => r.every((c) => c)).length;
const SPIN_TAG_OF: Partial<Record<Piece, string>> = { S: 's-spin', Z: 'z-spin' };

/** A nearly-clean board with right-side pockets/wells where an S/Z dig-spin lives. */
function randCleanBoard(): Grid {
  const b = emptyBoard();
  const base = 14 + Math.floor(Math.random() * 3);
  for (let c = 0; c < 10; c++) {
    const h = base - Math.floor(Math.random() * 2);
    for (let r = 19; r >= h; r--) b[r][c] = 1;
  }
  for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) {
    const c = 5 + Math.floor(Math.random() * 5);
    const r = base + Math.floor(Math.random() * 3);
    if (r <= 19) {
      b[r][c] = 0;
      if (r + 1 <= 19) b[r + 1][c] = 0;
    }
  }
  if (Math.random() < 0.5) {
    const wc = 8 + Math.floor(Math.random() * 2);
    for (let r = base; r <= 19; r++) b[r][wc] = 0;
  }
  return b;
}

/** Construct a board0 carrying a reachable S/Z DIG-spin (the spin is piece 1). */
function constructSZDigSpin(): { board: Grid; piece1: Piece; tag: string } | null {
  const b = randCleanBoard();
  if (fr(b) > 0 || cc(b) % 2 !== 0) return null;
  const h0 = boardMetrics(b).holes;
  if (h0 > 4 || h0 < 1) return null;
  for (const piece of ['S', 'Z'] as Piece[]) {
    const dig = inputReachableRestingPlacements(b, piece).find((pl) => {
      if (maneuver(b, piece, pl) !== 'spin') return false;
      const af = applyRestingPlacement(b, piece, pl);
      return (cc(b) + 4 - cc(af)) / 10 >= 1 && boardMetrics(af).holes < h0;
    });
    if (dig) return { board: b, piece1: piece, tag: SPIN_TAG_OF[piece]! };
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

const judge = createBetaTetrisJudge('szdig');

/** The stored optimal must perform the S/Z spin on piece 1 AND be reachable. */
function optimalIsReachableSpin(p: NewPuzzle, piece1: Piece): boolean {
  const entry = p.combos?.entries?.[0];
  if (!entry) return false;
  const board0 = decodeBoard(p.board);
  const line = restingLineForEntry(board0, p.piece1, p.piece2, entry);
  if (!line) return false;
  return maneuver(board0, piece1, line.p1) === 'spin' && isInputReachable(board0, piece1, line.p1);
}

async function main(): Promise<void> {
  const { engine, ensureEngine } = createManagedStackRabbit();
  if (!(await ensureEngine())) throw new Error('StackRabbit not reachable at :3000');
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);
  const existingKeys = await loadActiveBankKeys(client);
  console.log(`loaded ${existingKeys.length} active bank keys; target ${target} S/Z dig-spins${dryRun ? ' (dry-run)' : ''}`);
  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: 'X.....',
    maxHoles: 5,
    maxBumpiness: 40,
    varietyLane: { maxHoles: 5, maxBumpiness: 40, fraction: 1.0 },
  };
  const survivors: NewPuzzle[] = [];
  const acceptedKeys = [...existingKeys];
  const rejections: Record<string, number> = {};
  let constructed = 0;
  const cap = target * 200;
  while (survivors.length < target && constructed < cap) {
    const con = constructSZDigSpin();
    if (!con) continue;
    constructed++;
    if (!isNaturalBoard(con.board)) { rejections['unnatural-board'] = (rejections['unnatural-board'] ?? 0) + 1; continue; }
    const candidate: Candidate = { board: cloneBoard(con.board), colors: syntheticColors(con.board), currentPiece: con.piece1, nextPiece: 'O', level: 18, lines: 0 };
    let result;
    try {
      result = await assemblePuzzle(engine, candidate, config);
    } catch {
      rejections['engine-error'] = (rejections['engine-error'] ?? 0) + 1;
      await ensureEngine();
      continue;
    }
    if (!result.ok) { rejections[result.reason] = (rejections[result.reason] ?? 0) + 1; continue; }
    if (!(result.puzzle.tags ?? []).some((t) => t === con.tag)) { rejections['optimal-not-this-spin'] = (rejections['optimal-not-this-spin'] ?? 0) + 1; continue; }
    if (!optimalIsReachableSpin(result.puzzle, con.piece1)) { rejections['not-reachable'] = (rejections['not-reachable'] ?? 0) + 1; continue; }
    const dupKey: BankKey = { board: con.board, piece1: con.piece1, piece2: 'O' };
    if (isNearDuplicate(dupKey, acceptedKeys, config.dedupMaxHamming)) { rejections['duplicate'] = (rejections['duplicate'] ?? 0) + 1; continue; }
    acceptedKeys.push(dupKey);
    survivors.push(result.puzzle);
  }
  console.log(`assembled ${survivors.length} S/Z dig-spin puzzles from ${constructed} constructions`);
  console.log('rejections:', rejections);
  const consensus = await filterByConsensus(survivors, judge, { existing: existingKeys, maxHamming: config.dedupMaxHamming });
  console.log(`\nBetaTetris consensus: kept ${consensus.kept.length}/${survivors.length} (rate ${(consensus.keepRate * 100).toFixed(0)}%, bt-errors ${consensus.btErrors})`);
  const dr: Record<string, number> = {};
  for (const d of consensus.dropped) dr[d.reason] = (dr[d.reason] ?? 0) + 1;
  if (consensus.dropped.length) console.log('  dropped:', dr);
  const kept = consensus.kept;
  if (dryRun) {
    console.log(`\n--dry-run: would insert ${kept.length} S/Z dig-spins:`);
    for (const p of kept) console.log(`  ${p.piece1}+${p.piece2} [${(p.tags ?? []).join(',')}]`);
  } else if (kept.length) {
    const stored = await db.insertPuzzles(kept);
    console.log(`\ninserted ${stored.length}:`);
    for (const p of stored) console.log(`  #${p.number} ${p.piece1}+${p.piece2} (${(p.tags ?? []).filter((t) => t.endsWith('-spin')).join('+')})`);
  } else {
    console.log('\nnothing to insert');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
