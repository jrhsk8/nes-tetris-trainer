/**
 * One-time live-bank repair for the BetaTetris consensus gate (#55).
 *
 * Brings the LIVE puzzle bank into line with the new standard generation gate:
 * every stored puzzle must be the BetaTetris normal net's #1 piece-1 move
 * (docs/decisions.md, 2026-06-21). It:
 *
 *   1. Self-backs-up the bank to `puzzles_bak_pre55_<date>` (DDL via psql). No
 *      existing `*_bak_*` table is touched.
 *   2. Consensus-filters the live bank (BetaTetris normal-net top-1), dropping
 *      the disagreers (their attempts cascade). Fail-closed.
 *   3. Backfills via generate→filter (the standard path) to restore each
 *      difficulty band to its pre-repair count, so the easy/medium/hard spread
 *      (#52) is preserved — every backfilled puzzle is itself consensus-blessed.
 *   4. Verifies the shipped bank is 100% top-1-consensus and reports.
 *
 * Offline / generator-only (StackRabbit + BetaTetris). Run:
 *   bt-run npx tsx generator/src/repair-bank.ts            # full repair
 *   bt-run npx tsx generator/src/repair-bank.ts --dry-run  # measure only, no writes
 *
 * Env: STACKRABBIT_URL, SUPABASE_URL, service key, DATABASE_URL; REPAIR_DATE to
 * stamp the backup table (defaults to 20260622); REPAIR_MAX_CANDIDATES caps the
 * backfill candidate budget.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decodeBoard, type Grid, type Line } from '@trainer/core';
import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { SelfPlayBoardSource } from './selfplay/index.js';
import {
  bandFor,
  betaTetrisJudge,
  filterByConsensus,
  generateBank,
  DIFFICULTY_BANDS,
  type BankKey,
  type ConsensusPuzzle,
  type DifficultyBand,
} from './pipeline/index.js';

interface LivePuzzle extends ConsensusPuzzle {
  id: string;
  number: number | null;
  acceptCount: number | null;
}

function bandCounts(rows: Array<{ acceptCount: number | null }>): Record<DifficultyBand, number> {
  const counts: Record<DifficultyBand, number> = { 'very-easy': 0, easy: 0, medium: 0, hard: 0 };
  for (const r of rows) counts[bandFor(r.acceptCount ?? 0)]++;
  return counts;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const stackUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL + service key required');
  if (!databaseUrl && !dryRun) throw new Error('DATABASE_URL required for the backup DDL');
  const date = process.env.REPAIR_DATE ?? '20260622';
  const maxCandidates = Number(process.env.REPAIR_MAX_CANDIDATES ?? 6000);

  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);
  const engine = new StackRabbitClient({ baseUrl: stackUrl });
  if (!(await engine.ping())) throw new Error(`StackRabbit not reachable at ${stackUrl}`);
  const judge = betaTetrisJudge();
  const log = (m: string) => console.log(m);

  // --- read the live bank ----------------------------------------------------
  const { data, error } = await client
    .from('puzzles')
    .select('id, number, board, piece1, piece2, optimal_line, accept_count')
    .order('number', { ascending: true });
  if (error) throw new Error(error.message);
  const live: LivePuzzle[] = (data ?? []).map((r) => ({
    id: String(r.id),
    number: r.number as number | null,
    board: r.board as string,
    piece1: r.piece1 as string,
    piece2: r.piece2 as string,
    optimalLine: r.optimal_line as unknown as Line,
    acceptCount: (r.accept_count as number | null) ?? null,
  }));
  const startBands = bandCounts(live);
  log(`live bank: ${live.length} puzzles [easy ${startBands.easy} / medium ${startBands.medium} / hard ${startBands.hard}]`);

  // --- 1. backup (DDL via psql) ---------------------------------------------
  const bak = `puzzles_bak_pre55_${date}`;
  if (!dryRun) {
    log(`backing up → ${bak}`);
    const r = spawnSync('psql', [databaseUrl!, '-v', 'ON_ERROR_STOP=1', '-c',
      `create table if not exists ${bak} as select * from puzzles`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('backup failed');
  }

  // --- 2. consensus-filter the live bank ------------------------------------
  // Reuse a precomputed verdict file (--verdict <path>, the consensus_verdict.json
  // a prior `consensus.py` run wrote) to skip the ~15-min re-judge; otherwise
  // judge live. Either way the final step re-judges to VERIFY 100% consensus.
  const verdictArg = process.argv.indexOf('--verdict');
  let verdict: Awaited<ReturnType<typeof filterByConsensus<LivePuzzle>>>;
  if (verdictArg !== -1 && process.argv[verdictArg + 1]) {
    const raw = JSON.parse(readFileSync(process.argv[verdictArg + 1], 'utf8')) as Array<{
      id?: string;
      number?: number | null;
      keep: boolean;
      reason: string | null;
    }>;
    const keepById = new Map(raw.map((v) => [String(v.id), v.keep]));
    const keepByNum = new Map(raw.map((v) => [v.number, v.keep]));
    // Fail-closed: a puzzle with no verdict entry is dropped (treated bt-error).
    const kept = live.filter((p) => keepById.get(p.id) ?? keepByNum.get(p.number) ?? false);
    const dropped = live
      .filter((p) => !(keepById.get(p.id) ?? keepByNum.get(p.number) ?? false))
      .map((p) => ({ puzzle: p, reason: 'disagree' as const }));
    verdict = { kept, dropped, keepRate: kept.length / live.length, btErrors: 0, verdicts: [] };
    log(`loaded precomputed verdict (${process.argv[verdictArg + 1]})`);
  } else {
    log(`judging the live bank on the BetaTetris normal net (top-1)…`);
    verdict = await filterByConsensus(live, judge);
  }
  const byReason: Record<string, number> = {};
  for (const d of verdict.dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  log(`consensus: keep ${verdict.kept.length}/${live.length} (${(100 * verdict.keepRate).toFixed(0)}%); ` +
    `drop ${verdict.dropped.length} ${JSON.stringify(byReason)}; bt-errors ${verdict.btErrors}`);

  if (dryRun) {
    log('dry-run: no writes. Backfill would target ' +
      JSON.stringify({
        easy: startBands.easy - (bandCounts(verdict.kept as LivePuzzle[]).easy),
        medium: startBands.medium - (bandCounts(verdict.kept as LivePuzzle[]).medium),
        hard: startBands.hard - (bandCounts(verdict.kept as LivePuzzle[]).hard),
      }));
    return;
  }

  // SAFETY: backfill FIRST (append blessed puzzles), then drop the disagreers —
  // strictly safer than drop-then-backfill on a LIVE bank. The bank never dips
  // below its current size, and an interruption leaves a valid bank (the new
  // puzzles are BT-blessed; the disagreers are simply not yet culled). Same end
  // state as the issue's drop-then-backfill.

  // --- 3. backfill to the pre-repair band spread (generate → filter) --------
  const keptBands = bandCounts(verdict.kept as LivePuzzle[]);
  const deficit: Partial<Record<DifficultyBand, number>> = {};
  for (const b of DIFFICULTY_BANDS) deficit[b] = Math.max(0, startBands[b] - keptBands[b]);
  const need = DIFFICULTY_BANDS.reduce((s, b) => s + (deficit[b] ?? 0), 0);
  log(`backfilling ${need} puzzles to restore bands ${JSON.stringify(deficit)}`);

  if (need > 0) {
    // Dedup against the WHOLE current bank (incl. the not-yet-dropped disagreers),
    // so a backfilled puzzle never duplicates any existing board.
    const existingKeys: BankKey[] = live.map((p) => ({
      piece1: p.piece1 as BankKey['piece1'],
      piece2: p.piece2 as BankKey['piece2'],
      board: decodeBoard(p.board) as Grid,
    }));
    const source = new SelfPlayBoardSource(engine);
    const result = await generateBank(
      { source, engine, db, existingKeys, consensusJudge: judge },
      { targetCount: need, bandQuotas: deficit, maxCandidates, replace: false, onProgress: (m) => log(`  ${m}`) },
    );
    log(`backfill stored ${result.stored.length} (tried ${result.candidatesTried}); ` +
      `rejections ${JSON.stringify(result.rejections)}`);
  }

  // --- 4. drop the disagreers (attempts cascade) ----------------------------
  const dropIds = verdict.dropped.map((d) => (d.puzzle as LivePuzzle).id);
  for (let i = 0; i < dropIds.length; i += 100) {
    const chunk = dropIds.slice(i, i + 100);
    const del = await client.from('puzzles').delete().in('id', chunk);
    if (del.error) throw new Error(`delete failed: ${del.error.message}`);
  }
  log(`dropped ${dropIds.length} disagreers`);

  // --- 5. verify the shipped bank is 100% top-1-consensus -------------------
  const { data: finalData, error: finalErr } = await client
    .from('puzzles')
    .select('id, number, board, piece1, piece2, optimal_line, accept_count')
    .order('number', { ascending: true });
  if (finalErr) throw new Error(finalErr.message);
  const finalPuzzles: LivePuzzle[] = (finalData ?? []).map((r) => ({
    id: String(r.id),
    number: r.number as number | null,
    board: r.board as string,
    piece1: r.piece1 as string,
    piece2: r.piece2 as string,
    optimalLine: r.optimal_line as unknown as Line,
    acceptCount: (r.accept_count as number | null) ?? null,
  }));
  const check = await filterByConsensus(finalPuzzles, judge);
  const finalBands = bandCounts(finalPuzzles);
  log(`\nFINAL bank: ${finalPuzzles.length} puzzles ` +
    `[easy ${finalBands.easy} / medium ${finalBands.medium} / hard ${finalBands.hard}]`);
  log(`consensus check: keep ${check.kept.length}/${finalPuzzles.length} ` +
    `(${(100 * check.keepRate).toFixed(1)}%); bt-errors ${check.btErrors}`);
  if (check.kept.length !== finalPuzzles.length) {
    throw new Error(`bank NOT 100% consensus: ${check.dropped.length} still disagree`);
  }
  log('✓ shipped bank is 100% top-1-consensus');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
