/**
 * Re-evaluate the 70 metric-generated spin/tuck puzzles (#2332–#2401) through
 * the real StackRabbit engine pipeline + BetaTetris consensus filter, replacing
 * synthetic scores with engine-derived values. Puzzles that fail any gate are
 * deactivated (soft-deleted); survivors are updated in place.
 *
 * Requires:
 *   - StackRabbit running locally (STACKRABBIT_URL or default 127.0.0.1:3000)
 *   - BetaTetris reachable via `bt-run` (--consensus flag; optional without it)
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   NODE_OPTIONS="--experimental-websocket" npx tsx generator/src/spin-reeval.ts [--consensus] [--dry-run]
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  decodeBoard,
  boardMetrics,
  tagPuzzle,
  isPiece,
  CORRECT_SCORE_THRESHOLD,
  type Line,
  type Piece,
} from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';
import type { ComboTable } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import {
  sweepCombos,
  rank1QualityReason,
  rankCombosBySanity,
  normalizeCombos,
  normalizedScores,
  isReachablePlacement,
  type ComboContext,
  type ScoredCombo,
} from './pipeline/combo.js';
import {
  deeperConfirmBest,
  DEFAULT_DEEPER_CONFIRM,
} from './pipeline/deeper.js';
import {
  difficultyFromScores,
  seedRatingFor,
  lineClearsTetris,
} from './pipeline/difficulty.js';
import {
  betaTetrisJudge,
  filterByConsensus,
} from './pipeline/consensus.js';
import { applyRestingPlacement } from '@trainer/core';

const FIRST_PUZZLE = 2332;
const LAST_PUZZLE = 2401;
const TOP_K = 30;
const LEVEL = 18;
const LINES = 0;

interface LoadedPuzzle {
  id: string;
  number: number;
  board: string;
  piece1: Piece;
  piece2: Piece;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const useConsensus = args.includes('--consensus');
  const timelineArg = args.find((a) => a.startsWith('--timeline='));
  const TIMELINE = timelineArg ? timelineArg.split('=')[1] : 'X.';
  console.log(`timeline: ${TIMELINE}`);

  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !key) throw new Error('SUPABASE_URL + service key required');

  const client = createSupabaseClient(supabaseUrl, key);
  const engineUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const engine = new StackRabbitClient({ baseUrl: engineUrl });

  // Auto-managed StackRabbit: start and restart on crash
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const srDir = join(repoRoot, 'engines', 'stackrabbit');
  const srApp = join(srDir, 'built', 'src', 'server', 'app.js');
  const sr: { proc: ChildProcess | null } = { proc: null };

  function killEngine(): void {
    if (!sr.proc) return;
    const pid = sr.proc.pid;
    sr.proc.kill('SIGKILL');
    sr.proc = null;
    if (pid && process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
  }

  process.on('exit', killEngine);
  process.on('SIGINT', () => { killEngine(); process.exit(1); });
  process.on('SIGTERM', () => { killEngine(); process.exit(1); });

  async function ensureEngine(): Promise<boolean> {
    if (await engine.ping()) return true;
    killEngine();
    console.log('  (re)starting StackRabbit…');
    try {
      sr.proc = spawn(process.execPath, [srApp], {
        cwd: srDir,
        env: { ...process.env, PORT: '3000' },
        stdio: 'ignore',
      });
      sr.proc.on('error', () => { sr.proc = null; });
      sr.proc.on('exit', () => { sr.proc = null; });
    } catch {
      return false;
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await engine.ping()) return true;
    }
    console.log('  engine failed to start');
    return false;
  }

  if (!(await ensureEngine())) {
    throw new Error(`StackRabbit not reachable at ${engineUrl}`);
  }
  console.log(`engine alive at ${engineUrl}`);

  // Load the 70 puzzles
  const puzzles: LoadedPuzzle[] = [];
  for (let num = FIRST_PUZZLE; num <= LAST_PUZZLE; num++) {
    const { data, error } = await client
      .from('puzzles')
      .select('id, number, board, piece1, piece2')
      .eq('number', num)
      .maybeSingle();
    if (error) throw new Error(`load #${num}: ${error.message}`);
    if (!data) { console.log(`#${num}: not found, skipping`); continue; }
    if (!isPiece(data.piece1) || !isPiece(data.piece2)) {
      console.log(`#${num}: invalid pieces, skipping`);
      continue;
    }
    puzzles.push({
      id: data.id,
      number: data.number,
      board: data.board,
      piece1: data.piece1 as Piece,
      piece2: data.piece2 as Piece,
    });
  }
  console.log(`loaded ${puzzles.length} puzzles (#${FIRST_PUZZLE}–#${LAST_PUZZLE})\n`);

  interface Survivor {
    puzzle: LoadedPuzzle;
    combos: ComboTable;
    optimalLine: Line;
    optimalMetrics: ReturnType<typeof boardMetrics>;
    tags: string[];
    acceptCount: number;
    margin: number;
    seed: number;
  }

  const survivors: Survivor[] = [];
  const dropped: Array<{ puzzle: LoadedPuzzle; reason: string }> = [];

  for (const p of puzzles) {
    // Ensure engine is alive before each puzzle (it may segfault on bad boards)
    if (!(await ensureEngine())) {
      console.log(`#${p.number}: engine dead, skipping`);
      dropped.push({ puzzle: p, reason: 'engine-dead' });
      continue;
    }

    const board = decodeBoard(p.board);
    const ctx: ComboContext = {
      board,
      piece1: p.piece1,
      piece2: p.piece2,
      level: LEVEL,
      lines: LINES,
    };

    // Sweep all combos through real engine
    console.log(`#${p.number}: sweeping ${p.piece1}+${p.piece2}…`);
    let combos: ScoredCombo[];
    try {
      combos = await sweepCombos(engine, ctx, TIMELINE);
    } catch (err) {
      const reason = `sweep-error: ${err instanceof Error ? err.message : err}`;
      console.log(`  DROP: ${reason}`);
      dropped.push({ puzzle: p, reason });
      continue;
    }

    if (combos.length === 0) {
      console.log(`  DROP: no-rateable-combos`);
      dropped.push({ puzzle: p, reason: 'no-rateable-combos' });
      continue;
    }

    // Rank-1 quality gate
    const qualityReason = rank1QualityReason(combos[0], combos);
    if (qualityReason) {
      console.log(`  DROP: ${qualityReason}`);
      dropped.push({ puzzle: p, reason: qualityReason });
      continue;
    }

    // Dominance-respecting re-rank
    const ranked = rankCombosBySanity(combos);

    // Deeper-StackRabbit confirm
    let best = ranked[0];
    let ordered: readonly ScoredCombo[] = ranked;
    const decision = await deeperConfirmBest(engine, ctx, ranked, TIMELINE, DEFAULT_DEEPER_CONFIRM);
    if (decision.kind === 'reject') {
      console.log(`  DROP: ${decision.reason}`);
      dropped.push({ puzzle: p, reason: decision.reason });
      continue;
    }
    if (decision.kind === 'reranked') {
      const maxValue = Math.max(...ranked.map((c) => c.value));
      best = { ...decision.best, value: maxValue };
      ordered = [best, ...ranked.filter((c) => c !== decision.best)];
    }

    // Reachability check
    const boardAfter1 = applyRestingPlacement(board, p.piece1, best.p1);
    const reachable =
      isReachablePlacement(board, p.piece1, best.p1) &&
      isReachablePlacement(boardAfter1, p.piece2, best.p2);
    if (!reachable) {
      console.log(`  DROP: optimal-unreachable`);
      dropped.push({ puzzle: p, reason: 'optimal-unreachable' });
      continue;
    }

    // Normalize scores from real engine values
    const scores = normalizedScores(ordered);
    const difficulty = difficultyFromScores(scores);
    const tetris = ordered.some(
      (c, i) =>
        scores[i] >= CORRECT_SCORE_THRESHOLD &&
        lineClearsTetris(board, p.piece1, p.piece2, c.p1, c.p2),
    );
    const seed = seedRatingFor(difficulty, { tetris });
    const table = normalizeCombos(ordered, TOP_K);
    const optimalLine: Line = [
      { rotation: best.p1.rotation, col: best.p1.col },
      { rotation: best.p2.rotation, col: best.p2.col },
    ];
    const tags = tagPuzzle(board, p.piece1, p.piece2, table.entries[0], table);

    console.log(
      `  PASS: ${combos.length} combos, accept=${difficulty.acceptCount}, ` +
        `margin=${difficulty.margin.toFixed(1)}, seed=${seed}, ` +
        `tags=[${tags.join(', ')}], decision=${decision.kind}`,
    );

    survivors.push({
      puzzle: p,
      combos: table,
      optimalLine,
      optimalMetrics: boardMetrics(best.board2),
      tags,
      acceptCount: difficulty.acceptCount,
      margin: difficulty.margin,
      seed,
    });
  }

  console.log(`\nengine pass: ${survivors.length} survived, ${dropped.length} dropped`);

  // BetaTetris consensus filter
  let finalSurvivors = survivors;
  if (useConsensus) {
    console.log(`\nrunning BetaTetris consensus on ${survivors.length} survivors…`);
    const btRunner = process.platform === 'win32'
      ? new URL('../../engines/betatetris/bt-run.cmd', import.meta.url).pathname.replace(/^\//, '')
      : 'bt-run';
    const judge = betaTetrisJudge({ runner: btRunner });
    const consensusPuzzles = survivors.map((s, i) => ({
      id: s.puzzle.id,
      number: s.puzzle.number,
      board: s.puzzle.board,
      piece1: s.puzzle.piece1,
      piece2: s.puzzle.piece2,
      optimalLine: s.optimalLine as Line,
      _idx: i,
    }));

    const result = await filterByConsensus(consensusPuzzles, judge);
    const keptIds = new Set(result.kept.map((k) => k.id));
    finalSurvivors = survivors.filter((s) => keptIds.has(s.puzzle.id));

    for (const { puzzle: dp, reason } of result.dropped) {
      const s = survivors.find((s) => s.puzzle.id === dp.id);
      if (s) {
        dropped.push({ puzzle: s.puzzle, reason: `consensus:${reason}` });
        console.log(`  #${dp.number}: consensus DROP (${reason})`);
      }
    }
    console.log(
      `consensus: kept ${result.kept.length}/${survivors.length} ` +
        `(rate=${(result.keepRate * 100).toFixed(0)}%, bt-errors=${result.btErrors})`,
    );
  }

  console.log(`\nfinal: ${finalSurvivors.length} to update, ${dropped.length} to deactivate`);

  if (dryRun) {
    console.log('\n--dry-run: no DB writes');
    for (const s of finalSurvivors) {
      console.log(`  would update #${s.puzzle.number}: seed=${s.seed} tags=[${s.tags.join(',')}]`);
    }
    for (const d of dropped) {
      console.log(`  would deactivate #${d.puzzle.number}: ${d.reason}`);
    }
    return;
  }

  // Update survivors in place
  let updated = 0;
  for (const s of finalSurvivors) {
    const { error } = await client
      .from('puzzles')
      .update({
        combos: s.combos,
        optimal_line: s.optimalLine,
        optimal_metrics: s.optimalMetrics,
        tags: s.tags,
        accept_count: s.acceptCount,
        margin: s.margin,
        rating: s.seed,
      })
      .eq('id', s.puzzle.id);
    if (error) {
      console.error(`  #${s.puzzle.number} update FAILED: ${error.message}`);
    } else {
      updated++;
    }
  }
  console.log(`updated ${updated}/${finalSurvivors.length} puzzles`);

  // Deactivate dropped puzzles
  let deactivated = 0;
  for (const d of dropped) {
    const { error } = await client
      .from('puzzles')
      .update({ active: false })
      .eq('id', d.puzzle.id);
    if (error) {
      console.error(`  #${d.puzzle.number} deactivate FAILED: ${error.message}`);
    } else {
      deactivated++;
    }
  }
  console.log(`deactivated ${deactivated}/${dropped.length} puzzles`);

  // Cleanup engine
  killEngine();

  // Summary
  console.log('\n--- SUMMARY ---');
  console.log(`total loaded:  ${puzzles.length}`);
  console.log(`engine pass:   ${survivors.length}`);
  if (useConsensus) console.log(`consensus pass: ${finalSurvivors.length}`);
  console.log(`updated:       ${updated}`);
  console.log(`deactivated:   ${deactivated}`);
  const reasons: Record<string, number> = {};
  for (const d of dropped) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  if (Object.keys(reasons).length > 0) {
    console.log('drop reasons:');
    for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${r}: ${n}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
