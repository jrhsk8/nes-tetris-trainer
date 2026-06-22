/**
 * Larger ADDITIVE bank generation (#73) — append NEW puzzles via the current
 * pipeline (cleaner boards #66 + BetaTetris consensus #55 + the 4-band + tetris
 * difficulty #71) until the bank reaches a target TOTAL size. Existing puzzles,
 * attempts, and ratings are PRESERVED — this only inserts new rows (never a
 * destructive re-bank).
 *
 * Target total is `BANK_TARGET` (env), defaulting to 1000 (the owner-set target,
 * docs/decisions.md 2026-06-22 → grill #6). The deficit (target − current count)
 * is the survivor target; 1000 is a hard ceiling — the run never generates
 * unbounded. New candidates are deduped against the existing bank (#40), so an
 * append never duplicates a stored board.
 *
 * LONG DATA-OP (sweep + consensus scale with volume — potentially hours). Run
 * directly, OUTSIDE the RALPH loop, with BetaTetris reachable via `bt-run`:
 *   bt-run npx tsx generator/src/additive-bank.ts
 *   bt-run npx tsx generator/src/additive-bank.ts --dry-run   # plan only, no run
 *
 * Env: STACKRABBIT_URL, SUPABASE_URL + service key, DATABASE_URL (backup DDL).
 * BANK_TARGET (default 1000), MAX_CANDIDATES (default 200000), REBAND_DATE for
 * the backup stamp (default 20260622). Offline / generator-only.
 */

import { spawnSync } from 'node:child_process';
import { decodeBoard, type Grid } from '@trainer/core';
import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { SelfPlayBoardSource } from './selfplay/index.js';
import { betaTetrisJudge, generateBank, type BankKey } from './pipeline/index.js';

interface ExistingRow {
  board: string;
  piece1: string;
  piece2: string;
}

function backupBank(databaseUrl: string, date: string): void {
  const table = `puzzles_bak_${date}_grill6`;
  const sql = `create table if not exists public.${table} as select * from public.puzzles;`;
  const res = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`backup DDL failed: ${res.stderr || res.stdout || res.error?.message}`);
  }
  console.log(`backup ensured → ${table}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const engineUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL + service key required');
  const bankTarget = Number(process.env.BANK_TARGET ?? 1000);
  const maxCandidates = Number(process.env.MAX_CANDIDATES ?? 200000);
  const date = process.env.REBAND_DATE ?? '20260622';

  const engine = new StackRabbitClient({ baseUrl: engineUrl });
  if (!(await engine.ping())) throw new Error(`StackRabbit not reachable at ${engineUrl}`);

  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const db = createDataAccess(client);

  // Read the existing bank for the count + dedup keys (the append must not
  // duplicate any stored board, #40).
  const { data, error } = await client.from('puzzles').select('board, piece1, piece2');
  if (error) throw new Error(`read existing bank failed: ${error.message}`);
  const existing = (data ?? []) as ExistingRow[];
  const currentCount = existing.length;
  const deficit = Math.max(0, bankTarget - currentCount);

  console.log(
    `bank: ${currentCount} existing → target ${bankTarget} ⇒ append ${deficit} new ` +
      `(max ${maxCandidates} candidates, consensus ON)`,
  );
  if (deficit === 0) {
    console.log('already at/over target — nothing to append.');
    return;
  }
  if (dryRun) {
    console.log('dry run — no generation, no writes.');
    return;
  }

  if (databaseUrl) backupBank(databaseUrl, date);
  else console.warn('DATABASE_URL unset — skipping backup DDL (a backup already exists from #71).');

  const existingKeys: BankKey[] = existing.map((p) => ({
    piece1: p.piece1 as BankKey['piece1'],
    piece2: p.piece2 as BankKey['piece2'],
    board: decodeBoard(p.board) as Grid,
  }));

  const source = new SelfPlayBoardSource(engine);
  const result = await generateBank(
    { source, engine, db, existingKeys, consensusJudge: betaTetrisJudge() },
    {
      targetCount: deficit, // additive: append up to the deficit; existing rows untouched
      maxCandidates,
      replace: false,
      onProgress: (message) => console.log(`  ${message}`),
    },
  );

  console.log(`\nappended ${result.stored.length} puzzles from ${result.candidatesTried} candidates.`);
  console.log(
    `by band: very-easy ${result.byBand['very-easy']} / easy ${result.byBand.easy} / ` +
      `medium ${result.byBand.medium} / hard ${result.byBand.hard}.`,
  );

  const { count: finalCount } = await client
    .from('puzzles')
    .select('*', { count: 'exact', head: true });
  console.log(`bank total now: ${finalCount ?? 'unknown'} (target ${bankTarget}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
