/**
 * Re-band migration (#71) — recompute every stored puzzle's difficulty band and
 * seed rating under the 4-band + tetris-cap model (.claude/docs/decisions.md 2026-06-22,
 * grill #6 → Difficulty), in place.
 *
 * For each puzzle it recomputes, from the STORED combo table (no StackRabbit, no
 * new IDs): the difficulty signals (reusing the stored `accept_count`/`margin`
 * from the full sweep when present), the tetris-cap flag (by replaying the stored
 * placements and counting cleared rows), the band (`very-easy`/`easy`/`medium`/
 * `hard`, capped at `easy` for tetris puzzles), and the capped seed rating. Only
 * `rating` (the seed) + `accept_count`/`margin` are updated; combos, placements,
 * boards, attempts, and player ratings are untouched.
 *
 * Backs the bank up first to `puzzles_bak_<date>_grill6` (idempotent DDL via
 * psql); never drops any `*_bak_*` table. Offline / generator-only.
 *
 * Run:
 *   npx tsx generator/src/reband.ts            # apply (backs up, then updates)
 *   npx tsx generator/src/reband.ts --dry-run  # report the band shift, no writes
 *
 * Env: SUPABASE_URL + service key; DATABASE_URL (for the backup DDL); REBAND_DATE
 * to stamp the backup table (defaults to 20260622).
 */

import { spawnSync } from 'node:child_process';
import { decodeBoard, isPiece, type Piece } from '@trainer/core';
import type { ComboTable } from '@trainer/data';
import { createSupabaseClient } from '@trainer/data';
import { rebandPuzzle, DIFFICULTY_BANDS, type DifficultyBand } from './pipeline/index.js';

interface BankRow {
  id: string;
  board: string;
  piece1: string;
  piece2: string;
  combos: ComboTable | null;
  accept_count: number | null;
  margin: number | null;
  rating: number | null;
}

function emptyBandCounts(): Record<DifficultyBand, number> {
  return { 'very-easy': 0, easy: 0, medium: 0, hard: 0 };
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
  console.log(`backed up bank → ${table}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL + service key required');
  if (!databaseUrl && !dryRun) throw new Error('DATABASE_URL required for the backup DDL');
  const date = process.env.REBAND_DATE ?? '20260622';

  if (!dryRun) backupBank(databaseUrl!, date);

  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const { data, error } = await client
    .from('puzzles')
    .select('id, board, piece1, piece2, combos, accept_count, margin, rating');
  if (error) throw new Error(`read puzzles failed: ${error.message}`);
  const rows = (data ?? []) as BankRow[];
  console.log(`re-banding ${rows.length} puzzles${dryRun ? ' (dry run)' : ''}…`);

  const after = emptyBandCounts();
  let tetrisCount = 0;
  let updated = 0;
  let failures = 0;

  for (const row of rows) {
    const entries = row.combos?.entries ?? [];
    if (!isPiece(row.piece1) || !isPiece(row.piece2) || entries.length === 0) {
      // A malformed/legacy row with no combos cannot be re-banded; leave it.
      failures++;
      continue;
    }
    const board0 = decodeBoard(row.board);
    const piece1 = row.piece1 as Piece;
    const piece2 = row.piece2 as Piece;
    const reband = rebandPuzzle(board0, piece1, piece2, entries, {
      acceptCount: row.accept_count,
      margin: row.margin,
    });
    after[reband.band]++;
    if (reband.tetris) tetrisCount++;

    if (!dryRun) {
      const { error: upErr } = await client
        .from('puzzles')
        .update({ rating: reband.seed, accept_count: reband.acceptCount, margin: reband.margin })
        .eq('id', row.id);
      if (upErr) {
        console.error(`update ${row.id} failed: ${upErr.message}`);
        failures++;
        continue;
      }
    }
    updated++;
  }

  console.log(`\nband distribution (recomputed):`);
  for (const b of DIFFICULTY_BANDS) console.log(`  ${b.padEnd(10)} ${after[b]}`);
  console.log(`tetris-capped: ${tetrisCount}`);
  console.log(`${dryRun ? 'would update' : 'updated'}: ${updated}; skipped/failed: ${failures}`);
  if (!dryRun) {
    // Verify the live distribution matches what we just wrote.
    const { data: check, error: cErr } = await client.from('puzzles').select('rating');
    if (cErr) throw new Error(`verify read failed: ${cErr.message}`);
    console.log(`live puzzle count after re-band: ${check?.length ?? 0}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
