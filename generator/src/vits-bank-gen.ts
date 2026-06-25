/**
 * VITS — Vertical I Tuck Setup generator (#95).
 *
 * A vertical I tucks into a 4-deep roofed pocket cleanly (no line clear), which
 * fills the pocket's covered cells and leaves the entry column as a clean 4-deep
 * **tetris well** — the board becomes tetris-ready, the payoff that makes the tuck
 * genuinely best. Because it clears nothing, VITS uses its OWN bar (it cannot pass
 * the line-clearing 7/7 consensus — the #54 problem):
 *
 *   1. StackRabbit rank-1 (the vertical-I tuck is the optimal move),
 *   2. leaves the board tetris-ready (and was NOT tetris-ready before),
 *   3. interactively reachable under the input model (#91),
 *   4. **relaxed BetaTetris** — our optimal is within BT's top-`RELAX_RANK` policy
 *      (default 3, per #54's finding that our optimal lands top-3 ~72% of the time),
 *      NOT the exact top-1 gate.
 *
 * The run also prints BT's policy-rank DISTRIBUTION over the survivors so the
 * relaxed threshold can be calibrated from data (the way MARGIN was in #47).
 *
 * The I is piece 1 (the tuck), O follows. Varied board source + in-batch board-
 * distance dedup so the batch stays diverse. Insert directly active.
 *
 *   npx tsx generator/src/vits-bank-gen.ts [--count N] [--relax K] [--dry-run]
 */
// @ts-expect-error - ws has no types here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyBoard,
  cloneBoard,
  decodeBoard,
  emptyColorGrid,
  applyRestingPlacement,
  enumerateResting,
  inputReachableRestingPlacements,
  maneuver,
  boardMetrics,
  boardKey,
  restingLineForEntry,
  lockAndClear,
  isInputReachable,
  ORIENTATIONS,
  type Grid,
  type Piece,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { boardHamming, type BankKey, isNearDuplicate } from './pipeline/dedup.js';
import type { ConsensusKeyRow, ConsensusVerdict } from './pipeline/consensus.js';
import { StackRabbitClient } from './engine/index.js';
import type { Candidate } from './selfplay/board-source.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 16;
const RELAX_RANK = Number(args[args.indexOf('--relax') + 1]) || 3;
const BATCH_MIN_HAMMING = 10;
const VERT = ORIENTATIONS.I.length - 1; // vertical I rotation

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

const R = (n: number) => Math.floor(Math.random() * n);
const cc = (b: Grid) => b.reduce((n, r) => n + r.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
const fr = (b: Grid) => b.filter((r) => r.every((c) => c)).length;

/** A vertical I can clear 4 lines somewhere on `b` (the tetris-ready predicate). */
function tetrisReady(b: Grid): boolean {
  return enumerateResting(b, 'I')
    .filter((p) => p.rotation === VERT)
    .some((p) => (cc(b) + 4 - cc(applyRestingPlacement(b, 'I', p))) / 10 === 4);
}

/**
 * A varied VITS board: a roofed 4-deep I-pocket at the BOTTOM (rows 16..19) of a
 * random column, an adjacent open entry column (the well that becomes tetris-ready
 * after the tuck), the rest filled to a random surface with light variety. The
 * vertical I comes down the entry column, shifts under the roof into the pocket.
 */
function variedVitsBoard(): { board: Grid; pocketCol: number } | null {
  const b = emptyBoard();
  const W = 2 + R(6); // pocket column 2..7
  const E = R(2) ? W - 1 : W + 1; // entry/well column beside it
  if (E < 0 || E > 9) return null;
  const surf = 8 + R(5); // surface row 8..12
  for (let c = 0; c < 10; c++) for (let r = 19; r >= surf; r--) b[r][c] = 1;
  for (let r = 16; r <= 19; r++) b[r][W] = 0; // pocket (covered: roof = filled surf..15)
  for (let r = surf; r <= 19; r++) b[r][E] = 0; // entry well, open full height
  for (let k = 0; k < R(3); k++) {
    const c = R(10);
    if (c !== W && c !== E && surf - 1 >= 0) b[surf - 1][c] = 1; // light surface jitter
  }
  if (fr(b) > 0 || cc(b) % 2 !== 0) return null;
  return { board: b, pocketCol: W };
}

function syntheticColors(board: Grid) {
  const colors = emptyColorGrid();
  for (let r = 0; r < board.length; r++)
    for (let c = 0; c < board[r].length; c++)
      if (board[r][c]) colors[r][c] = (((r * 7 + c * 3) % 3) + 1) as 1 | 2 | 3;
  return colors;
}

const BT = join(root, 'engines', 'betatetris');
const btEnv = {
  ...process.env,
  BT_HOME: BT + '\\',
  BT_REPO_PY: join(BT, 'betatetris-tablebase', 'python'),
  BT_MODELS: join(BT, 'models'),
  BT_OUT: BT + '\\',
};
/** Run consensus.py and return raw verdicts (we read `rank` ourselves for the relaxed bar). */
async function judgeRanks(rows: ConsensusKeyRow[]): Promise<Map<string, ConsensusVerdict>> {
  const dir = mkdtempSync(join(tmpdir(), 'bt-vits-'));
  const inPath = join(dir, 'keys.json');
  const outPath = join(dir, 'verdict.json');
  writeFileSync(inPath, JSON.stringify(rows));
  await new Promise<void>((resolve, reject) => {
    const ch = spawn('python', [join(BT, 'consensus.py'), inPath, outPath], { env: btEnv, stdio: ['ignore', 'inherit', 'inherit'] });
    ch.on('error', reject);
    ch.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`consensus.py exited ${c}`))));
  });
  const raw = JSON.parse(readFileSync(outPath, 'utf8')) as ConsensusVerdict[];
  return new Map(raw.map((v) => [String(v.id), v] as const));
}

/** Verify the stored optimal performs the reachable vertical-I tuck and leaves tetris-ready. */
function vitsOptimal(p: NewPuzzle): boolean {
  const entry = p.combos?.entries?.[0];
  if (!entry) return false;
  const board0 = decodeBoard(p.board);
  const line = restingLineForEntry(board0, p.piece1, p.piece2, entry);
  if (!line) return false;
  // piece 1 must be the vertical I, a reachable tuck, clearing nothing, leaving tetris-ready.
  if (p.piece1 !== 'I' || line.p1.rotation !== VERT) return false;
  if (maneuver(board0, 'I', line.p1) !== 'tuck') return false;
  if (!isInputReachable(board0, 'I', line.p1)) return false;
  const a = lockAndClear(board0, 'I', line.p1);
  if (a.cleared !== 0) return false; // no line clear
  if (boardMetrics(a.board).holes > boardMetrics(board0).holes) return false; // no new holes
  return !tetrisReady(board0) && tetrisReady(a.board); // the payoff
}

async function main(): Promise<void> {
  const engine = new StackRabbitClient({ baseUrl: process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000' });
  if (!(await engine.ping())) throw new Error('StackRabbit not reachable (start it first)');
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);
  const existingKeys: BankKey[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('puzzles').select('board, piece1, piece2').eq('active', true).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) existingKeys.push({ board: decodeBoard(r.board), piece1: r.piece1 as Piece, piece2: r.piece2 as Piece });
    if (!data || data.length < 1000) break;
  }
  console.log(`loaded ${existingKeys.length} active bank keys; target ${target} VITS; relaxed BT rank ≤ ${RELAX_RANK}${dryRun ? ' (dry-run)' : ''}`);
  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: 'X.....',
    maxHoles: 6,
    maxBumpiness: 50,
    varietyLane: { maxHoles: 6, maxBumpiness: 50, fraction: 1.0 },
  };
  const survivors: Array<{ puzzle: NewPuzzle; board: Grid }> = [];
  const acceptedBoards: Grid[] = [];
  const rejections: Record<string, number> = {};
  let constructed = 0;
  const cap = target * 200;
  while (survivors.length < target && constructed < cap) {
    const v = variedVitsBoard();
    if (!v) continue;
    // The vertical-I tuck into the pocket must be a reachable, clean, tetris-ready setup.
    const tgt = { rotation: VERT, row: 16, col: v.pocketCol };
    if (!inputReachableRestingPlacements(v.board, 'I').some((q) => q.rotation === VERT && q.row === 16 && q.col === v.pocketCol)) continue;
    if (maneuver(v.board, 'I', tgt) !== 'tuck') continue;
    const after = applyRestingPlacement(v.board, 'I', tgt);
    if ((cc(v.board) + 4 - cc(after)) / 10 !== 0) continue;
    if (boardMetrics(after).holes > boardMetrics(v.board).holes) continue;
    if (tetrisReady(v.board) || !tetrisReady(after)) continue;
    constructed++;
    if (acceptedBoards.some((ab) => boardHamming(ab, v.board) <= BATCH_MIN_HAMMING)) { rejections['batch-near-dup'] = (rejections['batch-near-dup'] ?? 0) + 1; continue; }
    if (isNearDuplicate({ piece1: 'I', piece2: 'O', board: v.board }, existingKeys, config.dedupMaxHamming)) { rejections['bank-dup'] = (rejections['bank-dup'] ?? 0) + 1; continue; }

    const candidate: Candidate = { board: cloneBoard(v.board), colors: syntheticColors(v.board), currentPiece: 'I', nextPiece: 'O', level: 18, lines: 0 };
    let result;
    try {
      result = await assemblePuzzle(engine, candidate, config);
    } catch {
      rejections['engine-error'] = (rejections['engine-error'] ?? 0) + 1;
      if (!(await engine.ping())) throw new Error('StackRabbit died mid-run');
      continue;
    }
    if (!result.ok) { rejections[result.reason] = (rejections[result.reason] ?? 0) + 1; continue; }
    if (!vitsOptimal(result.puzzle)) { rejections['optimal-not-vits'] = (rejections['optimal-not-vits'] ?? 0) + 1; continue; }
    acceptedBoards.push(v.board);
    survivors.push({ puzzle: result.puzzle, board: v.board });
  }
  console.log(`assembled ${survivors.length} StackRabbit-rank-1 VITS from ${constructed} constructions`);
  console.log('rejections:', rejections);
  if (survivors.length === 0) {
    console.log('nothing to judge');
    return;
  }

  // Relaxed BetaTetris: judge, bucket by policy rank (calibration), keep rank ≤ RELAX_RANK.
  const rows: ConsensusKeyRow[] = survivors.map((s, i) => {
    const board0 = decodeBoard(s.puzzle.board);
    const entry = s.puzzle.combos!.entries[0];
    const line = restingLineForEntry(board0, s.puzzle.piece1, s.puzzle.piece2, entry)!;
    const afterP1 = lockAndClear(board0, s.puzzle.piece1, line.p1).board;
    return {
      id: String(i),
      number: null,
      board: s.puzzle.board,
      piece1: s.puzzle.piece1,
      piece2: s.puzzle.piece2,
      p1_key: boardKey(afterP1),
      full_key: entry.boardKey ?? boardKey(afterP1),
    };
  });
  const verdicts = await judgeRanks(rows);
  const dist: Record<string, number> = {};
  const kept: NewPuzzle[] = [];
  survivors.forEach((s, i) => {
    const v = verdicts.get(String(i));
    const rank = v?.rank ?? null;
    const bucket = rank === null ? 'unreachable' : rank <= 1 ? 'rank-1' : rank <= 3 ? 'rank-2..3' : rank <= 7 ? 'rank-4..7' : 'rank-8+';
    dist[bucket] = (dist[bucket] ?? 0) + 1;
    if (rank !== null && rank <= RELAX_RANK) kept.push(s.puzzle);
  });
  console.log(`\nBetaTetris policy-rank distribution (n=${survivors.length}):`, dist);
  console.log(`relaxed bar (rank ≤ ${RELAX_RANK}): kept ${kept.length}/${survivors.length}`);

  if (dryRun) {
    console.log(`\n--dry-run: would insert ${kept.length} VITS:`);
    for (const p of kept) console.log(`  ${p.piece1}+${p.piece2} [${(p.tags ?? []).join(',')}]`);
  } else if (kept.length) {
    const stored = await db.insertPuzzles(kept);
    console.log(`\ninserted ${stored.length} VITS:`);
    for (const p of stored) console.log(`  #${p.number} ${p.piece1}+${p.piece2} [${(p.tags ?? []).join(',')}]`);
  } else {
    console.log('\nnothing to insert');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
