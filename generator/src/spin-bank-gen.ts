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
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cloneBoard,
  decodeBoard,
  emptyColorGrid,
  type ColorGrid,
  type Grid,
  type Piece,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { filterByConsensus, type ConsensusJudge } from './pipeline/consensus.js';
import { isNearDuplicate, type BankKey } from './pipeline/dedup.js';
import { constructTSpinDouble, coreVerify } from './spin-seed-gen.js';
import type { Candidate } from './selfplay/board-source.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 24;
const PER_COL_CAP = 4;

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
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

// Windows-safe BetaTetris judge: spawn consensus.py directly with the BT env set.
const BT = join(root, 'engines', 'betatetris');
const btEnv = {
  ...process.env,
  BT_HOME: BT + '\\',
  BT_REPO_PY: join(BT, 'betatetris-tablebase', 'python'),
  BT_MODELS: join(BT, 'models'),
  BT_OUT: BT + '\\',
};
const judge: ConsensusJudge = async (rows) => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-spin-'));
  const inPath = join(dir, 'keys.json');
  const outPath = join(dir, 'verdict.json');
  writeFileSync(inPath, JSON.stringify(rows));
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python', [join(BT, 'consensus.py'), inPath, outPath], { env: btEnv, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`consensus.py exited ${code}`))));
  });
  const raw = JSON.parse(readFileSync(outPath, 'utf8')) as any[];
  const byId = new Map(raw.map((v) => [v.id, v]));
  return rows.map((r) => byId.get(r.id));
};

async function main() {
  const engine = new StackRabbitClient({ baseUrl: process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000' });
  if (!(await engine.ping())) throw new Error('StackRabbit not reachable (start it first)');
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);

  // existing ACTIVE bank keys for dedup (paginated)
  const existingKeys: BankKey[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('puzzles').select('board, piece1, piece2').eq('active', true).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) existingKeys.push({ board: decodeBoard(r.board), piece1: r.piece1 as Piece, piece2: r.piece2 as Piece });
    if (!data || data.length < 1000) break;
  }
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
      if (!(await engine.ping())) throw new Error('StackRabbit died mid-run');
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
