/**
 * VITS — Vertical I Tuck Setup generator (#95, owner's verified template).
 *
 * Built from the owner's verified board `[11,10,9,8,8,8,8,4,2,0]` (J current, I
 * next): a tall-ish descending stack with a deep notch (col 8, 1-indexed), a low
 * pocket beside it (col 9), and an empty tetris well (col 10). The optimal line is
 * the SETUP piece into the notch + the vertical I into the pocket, which makes the
 * board **tetris-ready when it wasn't before** — and StackRabbit sells out for
 * tetris-readiness, so that line wins over a plain burn. This only holds in a
 * NARROW band (the pocket must sit in the bottom 0–3 rows; higher up a tetris
 * always beats it), so the set is intentionally low-variety: the owner's board
 * built slightly higher/lower, mirrored, with a J/L/T setup.
 *
 * Bar (the setup+I clears little or nothing, so it can't pass a 7/7 line-clear
 * gate): StackRabbit rank-1 — the assembled optimal IS [setup → vertical I] and it
 * makes the board tetris-ready (wasn't before) — + relaxed BetaTetris (optimal
 * within BT's top-`RELAX_RANK` policy, default 3).
 *
 *   npx tsx generator/src/vits-bank-gen.ts [--count N] [--relax K] [--dry-run]
 */
import {
  emptyBoard,
  cloneBoard,
  decodeBoard,
  emptyColorGrid,
  applyRestingPlacement,
  enumerateResting,
  boardMetrics,
  boardKey,
  restingLineForEntry,
  lockAndClear,
  ORIENTATIONS,
  type Grid,
  type Piece,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { isNaturalBoard } from './board-natural.js';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { boardHamming, isNearDuplicate } from './pipeline/dedup.js';
import type { ConsensusKeyRow, ConsensusVerdict } from './pipeline/consensus.js';
import { loadRepoEnv, createBetaTetrisJudge, createManagedStackRabbit, loadActiveBankKeys } from './gen-harness.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 16;
const RELAX_RANK = Number(args[args.indexOf('--relax') + 1]) || 3;
const BATCH_MIN_HAMMING = 8;
const VERT = ORIENTATIONS.I.length - 1; // vertical I rotation
const SETUP_PIECES: Piece[] = ['J', 'L', 'T'];

loadRepoEnv();
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
 * The owner's verified VITS board, parameterised: cols 0–6 descend from a peak to
 * a flat F, then a deep notch (col 7 = F-4), a low pocket (col 8, height 1–2, the
 * bottom-0–3 band), and an empty tetris well (col 9). Mirrored half the time.
 * F=8, peak 8–11 reproduces `[11,10,9,8,8,8,8,4,2,0]`; F and the peak vary it
 * slightly within the narrow band where the VITS stays optimal.
 */
function constructBoard(): Grid | null {
  const b = emptyBoard();
  const F = 8 + R(3); // flat height 8..10 (col 7 notch = F-4 ≥ 4)
  const peak = F + R(4); // far-left peak height
  const h: number[] = [];
  let cur = peak;
  for (let c = 0; c <= 6; c++) { h[c] = cur; cur = Math.max(F, cur - 1); } // descend to F then flat
  h[7] = F - 4; // deep notch
  h[8] = 1 + R(2); // pocket floor in the bottom 0–3 band
  h[9] = 0; // empty tetris well
  for (let c = 0; c < 10; c++) for (let r = 20 - h[c]; r < 20; r++) b[r][c] = 1;
  if (R(2) === 0) for (let r = 0; r < 20; r++) b[r].reverse(); // mirror (well on the left)
  if (fr(b) > 0 || cc(b) % 2 !== 0) return null;
  return b;
}

function syntheticColors(board: Grid) {
  const colors = emptyColorGrid();
  for (let r = 0; r < board.length; r++)
    for (let c = 0; c < board[r].length; c++)
      if (board[r][c]) colors[r][c] = (((r * 7 + c * 3) % 3) + 1) as 1 | 2 | 3;
  return colors;
}

const btJudge = createBetaTetrisJudge('vits');
/** Run consensus.py and return raw verdicts (we read `rank` ourselves for the relaxed bar). */
async function judgeRanks(rows: ConsensusKeyRow[]): Promise<Map<string, ConsensusVerdict>> {
  const verdicts = await btJudge(rows);
  const byId = new Map<string, ConsensusVerdict>();
  for (const v of verdicts) if (v) byId.set(String(v.id), v);
  return byId;
}

/**
 * The stored optimal IS a VITS: piece 2 is a vertical I, and the two-piece line
 * makes the board tetris-ready when it wasn't before. (The I may be a tuck or a
 * hard-drop into the pocket — what matters is the setup+I reaching tetris-ready,
 * which is what StackRabbit rewards and what the adjustment trains.)
 */
function vitsOptimal(p: NewPuzzle): boolean {
  const entry = p.combos?.entries?.[0];
  if (!entry) return false;
  const board0 = decodeBoard(p.board);
  const line = restingLineForEntry(board0, p.piece1, p.piece2, entry);
  if (!line) return false;
  if (p.piece2 !== 'I' || line.p2.rotation !== VERT) return false;
  const a1 = lockAndClear(board0, p.piece1, line.p1).board;
  const a2 = lockAndClear(a1, p.piece2, line.p2).board;
  if (boardMetrics(a2).holes > boardMetrics(board0).holes) return false; // no net new holes
  return !tetrisReady(board0) && tetrisReady(a2); // the payoff
}

const render = (g: Grid) => {
  for (let r = 0; r < 20; r++) { let s = ''; for (let c = 0; c < 10; c++) s += g[r][c] ? '#' : '.'; if (s.includes('#')) console.log('    ' + s); }
};

async function main(): Promise<void> {
  const { engine, ensureEngine } = createManagedStackRabbit();
  if (!(await ensureEngine())) throw new Error('StackRabbit not reachable at :3000');
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);
  const existingKeys = await loadActiveBankKeys(client);
  console.log(`loaded ${existingKeys.length} active bank keys; target ${target} VITS; relaxed BT rank ≤ ${RELAX_RANK}${dryRun ? ' (dry-run)' : ''}`);
  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: 'X.', // the I must be REACHABLE (tuck/fast adjust) for the line to hold
    maxHoles: 8,
    maxBumpiness: 60,
    varietyLane: { maxHoles: 8, maxBumpiness: 60, fraction: 1.0 },
    deeperConfirm: null, // the VITS is shallow-unstable by design (its value is the I lookahead)
  };
  const survivors: Array<{ puzzle: NewPuzzle; board: Grid; piece: Piece }> = [];
  const acceptedBoards: Grid[] = [];
  const rejections: Record<string, number> = {};
  let attempts = 0;
  const cap = target * 1200; // VITS yield is low (narrow band) — give the search room
  while (survivors.length < target && attempts < cap) {
    attempts++;
    if (attempts % 100 === 0) console.log(`  …${attempts} attempts, ${survivors.length}/${target}`);
    const board = constructBoard();
    if (!board) continue;
    if (!isNaturalBoard(board)) continue;
    const setup = SETUP_PIECES[R(SETUP_PIECES.length)];
    if (acceptedBoards.some((ab) => boardHamming(ab, board) <= BATCH_MIN_HAMMING)) { rejections['batch-near-dup'] = (rejections['batch-near-dup'] ?? 0) + 1; continue; }
    if (isNearDuplicate({ piece1: setup, piece2: 'I', board }, existingKeys, config.dedupMaxHamming)) { rejections['bank-dup'] = (rejections['bank-dup'] ?? 0) + 1; continue; }

    if (!(await ensureEngine())) { console.log('StackRabbit unrecoverable — stopping'); break; }
    let result;
    try {
      result = await assemblePuzzle(engine, { board: cloneBoard(board), colors: syntheticColors(board), currentPiece: setup, nextPiece: 'I', level: 18, lines: 0 }, config);
    } catch {
      rejections['engine-error'] = (rejections['engine-error'] ?? 0) + 1;
      await ensureEngine();
      continue;
    }
    if (!result.ok) { rejections[result.reason] = (rejections[result.reason] ?? 0) + 1; continue; }
    if (!vitsOptimal(result.puzzle)) { rejections['optimal-not-vits'] = (rejections['optimal-not-vits'] ?? 0) + 1; continue; }
    acceptedBoards.push(board);
    survivors.push({ puzzle: result.puzzle, board, piece: setup });
  }
  console.log(`assembled ${survivors.length} StackRabbit-rank-1 VITS from ${attempts} attempts`);
  console.log('rejections:', rejections);
  if (survivors.length === 0) { console.log('nothing to judge'); return; }

  const rows: ConsensusKeyRow[] = survivors.map((s, i) => {
    const board0 = decodeBoard(s.puzzle.board);
    const entry = s.puzzle.combos!.entries[0];
    const line = restingLineForEntry(board0, s.puzzle.piece1, s.puzzle.piece2, entry)!;
    const afterP1 = lockAndClear(board0, s.puzzle.piece1, line.p1).board;
    return { id: String(i), number: null, board: s.puzzle.board, piece1: s.puzzle.piece1, piece2: s.puzzle.piece2, p1_key: boardKey(afterP1), full_key: entry.boardKey ?? boardKey(afterP1) };
  });
  const verdicts = await judgeRanks(rows);
  const dist: Record<string, number> = {};
  const kept: NewPuzzle[] = [];
  const keptMeta: Array<{ puzzle: NewPuzzle; board: Grid; piece: Piece }> = [];
  survivors.forEach((s, i) => {
    const rank = verdicts.get(String(i))?.rank ?? null;
    const bucket = rank === null ? 'unreachable' : rank <= 1 ? 'rank-1' : rank <= 3 ? 'rank-2..3' : rank <= 7 ? 'rank-4..7' : 'rank-8+';
    dist[bucket] = (dist[bucket] ?? 0) + 1;
    if (rank !== null && rank <= RELAX_RANK) { kept.push(s.puzzle); keptMeta.push(s); }
  });
  console.log(`\nBetaTetris policy-rank distribution (n=${survivors.length}):`, dist);
  console.log(`relaxed bar (rank ≤ ${RELAX_RANK}): kept ${kept.length}/${survivors.length}`);
  const pieceHist: Record<string, number> = {};
  for (const m of keptMeta) pieceHist[m.piece] = (pieceHist[m.piece] ?? 0) + 1;
  console.log('kept setup-piece split:', pieceHist);

  if (dryRun) {
    console.log(`\n--dry-run: would insert ${kept.length} VITS:`);
    for (const m of keptMeta.slice(0, 4)) { console.log(`\n  setup=${m.piece}+I [${(m.puzzle.tags ?? []).join(',')}]`); render(m.board); }
  } else if (kept.length) {
    const stored = await db.insertPuzzles(kept);
    console.log(`\ninserted ${stored.length} VITS:`);
    for (const p of stored) console.log(`  #${p.number} ${p.piece1}+${p.piece2} [${(p.tags ?? []).join(',')}]`);
  } else {
    console.log('\nnothing to insert');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
