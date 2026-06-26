/**
 * Spintuck generator (#follow-up) — puzzles whose optimal move is a SPINTUCK: a
 * placement reachable at NES level-19 speed ONLY by rotating the piece in at the
 * last second (you can't drop it pre-rotated and can't slide it under the lip in
 * time). See {@link isSpintuck} + `packages/core/src/nes-reachability.ts` and the
 * spintuck-definition memory.
 *
 * Real spintucks are RARE, and BetaTetris will NOT 7/7-agree a spintuck as the
 * SECOND piece (its policy doesn't enumerate the last-second spin as a 2nd move).
 * So strict-BT spintucks are **piece-1-framed only**: the spintuck is the first
 * move (BT must rank it #1), a filler O is piece 2 (BT agrees 7/7). Run with
 * `--framing p1`. Variety comes from the PIECE (T/S/Z/J/L/I) and the board.
 * Most spintucks are hole-reducing DIGS, which is why StackRabbit ranks them #1.
 *
 * Strict bar: StackRabbit rank-1 (optimal carries the 'spintuck' tag, implying
 * interactive-reachability) + BetaTetris consensus (p1 top-1 AND p2 7/7). In-batch
 * + bank dedup is folded into the consensus stage. Keep rate is low (~8%: BT
 * mostly can't enumerate the piece-1 spintuck) — expect a long run for few keeps.
 *
 *   npx tsx generator/src/spintuck-bank-gen.ts [--count N] [--framing p1] [--dry-run]
 */
import {
  cloneBoard,
  decodeBoard,
  emptyColorGrid,
  applyRestingPlacement,
  enumerateResting,
  inputReachableRestingPlacements,
  isSpintuck,
  boardMetrics,
  PIECES,
  type Grid,
  type Piece,
  type RestingPlacement,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient, type NewPuzzle } from '@trainer/data';
import { constructSpintuckBoard } from './spintuck-board.js';
import { isNaturalBoard, floatingCellCount } from './board-natural.js';
import { assemblePuzzle, DEFAULT_GENERATION_CONFIG, type GenerationConfig } from './pipeline/generate.js';
import { filterByConsensus } from './pipeline/consensus.js';
import { loadRepoEnv, createBetaTetrisJudge, createManagedStackRabbit, loadActiveBankKeys } from './gen-harness.js';
import type { Candidate } from './selfplay/board-source.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Number(args[args.indexOf('--count') + 1]) || 16;

loadRepoEnv();
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

const R = (n: number) => Math.floor(Math.random() * n);
const cc = (b: Grid) => b.reduce((n, r) => n + r.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
const fr = (b: Grid) => b.filter((r) => r.every((c) => c)).length;

/** Find a reachable spintuck on `b` (preferring a hole-reducing dig). */
function findSpintuck(b: Grid): { piece: Piece; placement: RestingPlacement; dig: boolean } | null {
  const h0 = boardMetrics(b).holes;
  let fallback: { piece: Piece; placement: RestingPlacement; dig: boolean } | null = null;
  for (const piece of [...PIECES].sort(() => Math.random() - 0.5)) {
    for (const pl of inputReachableRestingPlacements(b, piece)) {
      if (!isSpintuck(b, piece, pl)) continue;
      const dig = boardMetrics(applyRestingPlacement(b, piece, pl)).holes < h0;
      if (dig) return { piece, placement: pl, dig };
      if (!fallback) fallback = { piece, placement: pl, dig };
    }
  }
  return fallback;
}

/** Carve a top-open 2×2 O-gap of filled cells (not in `footprint`) so O refills it exactly. */
function carveOGap(board: Grid, footprint: Set<number>): { board0: Grid; oCol: number } | null {
  for (let R0 = 1; R0 < 19; R0++) {
    for (let g = 0; g < 9; g++) {
      const cells: Array<[number, number]> = [[R0 - 1, g], [R0 - 1, g + 1], [R0, g], [R0, g + 1]];
      if (cells.some(([r, c]) => !board[r][c] || footprint.has(r * 10 + c))) continue;
      if (board[R0 - 2]?.[g] || board[R0 - 2]?.[g + 1]) continue; // open above
      const board0 = cloneBoard(board);
      for (const [r, c] of cells) board0[r][c] = 0;
      if (fr(board0) > 0) continue;
      const o = enumerateResting(board0, 'O').filter((p) => p.col === g).sort((a, b) => b.row - a.row)[0];
      if (!o || o.row !== R0 - 1) continue;
      if (cc(applyRestingPlacement(board0, 'O', o)) !== cc(board)) continue; // refills exactly
      return { board0, oCol: g };
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

const judge = createBetaTetrisJudge('spintuck');

async function main(): Promise<void> {
  // One managed StackRabbit (shared if the orchestrator already started one).
  const { engine, ensureEngine } = createManagedStackRabbit();
  if (!(await ensureEngine())) throw new Error('StackRabbit not reachable at :3000');

  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);
  const existingKeys = await loadActiveBankKeys(client);
  console.log(`loaded ${existingKeys.length} active bank keys; target ${target} spintucks${dryRun ? ' (dry-run)' : ''}`);
  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: 'X.....',
    maxHoles: 8,
    maxBumpiness: 50,
    varietyLane: { maxHoles: 8, maxBumpiness: 50, fraction: 1.0 },
  };

  const survivors: NewPuzzle[] = [];
  const meta = new Map<NewPuzzle, { framing: string; piece: Piece; dig: boolean }>();
  const rejections: Record<string, number> = {};
  let constructed = 0;
  const cap = target * 4000; // spintucks are rare, so the board search dominates the assemble phase
  while (survivors.length < target && constructed < cap) {
    if (!(await ensureEngine())) {
      console.log('too many consecutive StackRabbit crashes — aborting early');
      break;
    }
    constructed++;
    const board = constructSpintuckBoard();
    if (fr(board) > 0 || cc(board) % 2 !== 0) continue;
    if (!isNaturalBoard(board, 6)) { rejections['unnatural-board'] = (rejections['unnatural-board'] ?? 0) + 1; continue; }
    const st = findSpintuck(board);
    if (!st) continue;
    // Random framing for anti-give-away variety (--framing p1|p2|mix overrides).
    const framingArg = args.indexOf('--framing') >= 0 ? args[args.indexOf('--framing') + 1] : 'mix';
    const piece2Framing = framingArg === 'p2' ? true : framingArg === 'p1' ? false : R(2) === 0;
    let board0: Grid;
    let p1: Piece;
    let p2: Piece;
    if (piece2Framing) {
      const F = new Set<number>(); // O-gap must avoid... (O can go anywhere not the spintuck cells is fine)
      const carved = carveOGap(board, F);
      if (!carved) { rejections['no-o-gap'] = (rejections['no-o-gap'] ?? 0) + 1; continue; }
      // After O refills, the spintuck must still hold on the refilled board (== board).
      board0 = carved.board0;
      p1 = 'O';
      p2 = st.piece;
    } else {
      board0 = board;
      p1 = st.piece;
      p2 = 'O';
    }
    const candidate: Candidate = { board: cloneBoard(board0), colors: syntheticColors(board0), currentPiece: p1, nextPiece: p2, level: 18, lines: 0 };
    let result;
    try {
      result = await assemblePuzzle(engine, candidate, config);
    } catch {
      rejections['engine-error'] = (rejections['engine-error'] ?? 0) + 1;
      await ensureEngine(); // restart on crash and keep going
      continue;
    }
    if (!result.ok) { rejections[result.reason] = (rejections[result.reason] ?? 0) + 1; continue; }
    if (!(result.puzzle.tags ?? []).some((t) => t === 'spintuck')) { rejections['optimal-not-spintuck'] = (rejections['optimal-not-spintuck'] ?? 0) + 1; continue; }
    meta.set(result.puzzle, { framing: piece2Framing ? 'p2' : 'p1', piece: st.piece, dig: st.dig });
    survivors.push(result.puzzle);
  }
  console.log(`assembled ${survivors.length} spintuck puzzles from ${constructed} constructions`);
  console.log('rejections:', rejections);
  if (!survivors.length) { console.log('nothing to judge'); return; }

  const consensus = await filterByConsensus(survivors, judge, { existing: existingKeys, maxHamming: config.dedupMaxHamming });
  console.log(`\nBetaTetris consensus: kept ${consensus.kept.length}/${survivors.length} (rate ${(consensus.keepRate * 100).toFixed(0)}%, bt-errors ${consensus.btErrors})`);
  const dr: Record<string, number> = {};
  for (const d of consensus.dropped) dr[d.reason] = (dr[d.reason] ?? 0) + 1;
  if (consensus.dropped.length) console.log('  dropped:', dr);

  const kept = consensus.kept;
  const splitFraming: Record<string, number> = {}, splitPiece: Record<string, number> = {}, splitDig: Record<string, number> = {};
  for (const p of kept) {
    const m = meta.get(p)!;
    splitFraming[m.framing] = (splitFraming[m.framing] ?? 0) + 1;
    splitPiece[m.piece] = (splitPiece[m.piece] ?? 0) + 1;
    splitDig[m.dig ? 'dig' : 'clean'] = (splitDig[m.dig ? 'dig' : 'clean'] ?? 0) + 1;
  }
  console.log(`\nkept split — framing:`, splitFraming, '| piece:', splitPiece, '| dig/clean:', splitDig);

  if (dryRun) {
    console.log(`\n--dry-run: would insert ${kept.length} spintucks:`);
    for (const p of kept) {
      const g = decodeBoard(p.board);
      console.log(`  ${p.piece1}+${p.piece2} [${(p.tags ?? []).join(',')}]  floatingCells=${floatingCellCount(g)}`);
      for (let r = 0; r < 20; r++) {
        let s = '';
        for (let c = 0; c < 10; c++) s += g[r][c] ? (r < 19 && !g[r + 1][c] ? '@' : '#') : '.';
        if (s.includes('#') || s.includes('@')) console.log('    ' + s);
      }
    }
  } else if (kept.length) {
    const stored = await db.insertPuzzles(kept);
    console.log(`\ninserted ${stored.length} spintucks:`);
    for (const p of stored) console.log(`  #${p.number} ${p.piece1}+${p.piece2} (${(p.tags ?? []).filter((t) => t.endsWith('-spin') || t === 'spintuck').join('+')})`);
  } else {
    console.log('\nnothing to insert');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
