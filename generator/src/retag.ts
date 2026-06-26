/**
 * Re-tag migration (#83) — recompute every stored puzzle's type-tags (#81/#90)
 * from its STORED data and update the `tags` column in place. Offline /
 * generator-only: no StackRabbit, no new IDs, no board/combo/attempt changes.
 *
 * For each puzzle it recomputes tags with {@link tagPuzzle} from the stored
 * `board` + `piece1`/`piece2` + the stored combo table (`combos.entries[0]` is
 * the rank-1 line; the full table feeds the rank-2/3 contrast tags). Legacy combo
 * rows whose rank-1 entry has no `boardKey` cannot reconstruct the resting line,
 * so they are best-effort: tags needing the line are skipped (the result may be
 * `[]` or contrast-tags-only) — consistent with the generation path.
 *
 * Idempotent: a re-run recomputes the same tags from the same stored data and
 * writes the same array. Reports per-tag counts over the bank after the run.
 *
 * Backs the bank up first to `puzzles_bak_<date>_retag` (idempotent DDL via psql);
 * never drops any `*_bak_*` table.
 *
 * Run:
 *   npx tsx generator/src/retag.ts            # apply (backs up, then updates)
 *   npx tsx generator/src/retag.ts --dry-run  # report the tag counts, no writes
 *
 * Env: SUPABASE_URL + service key; DATABASE_URL (for the backup DDL); RETAG_DATE
 * to stamp the backup table (defaults to 20260624).
 */

import { pathToFileURL } from 'node:url';
import { decodeBoard, isPiece, tagPuzzle, type Piece, type PuzzleTag } from '@trainer/core';
import type { ComboTable } from '@trainer/data';
import { createSupabaseClient } from '@trainer/data';
import { backupBank, pruneOldBackups } from './bank-backup.js';

export interface BankRow {
  id: string;
  board: string;
  piece1: string;
  piece2: string;
  combos: ComboTable | null;
  tags: string[] | null;
}

/** The deterministic result of re-tagging a set of rows (the testable core). */
export interface RetagResult {
  /** The recomputed tags per puzzle id, in input order. */
  updates: { id: string; tags: PuzzleTag[] }[];
  /** Per-tag counts over the whole set (a puzzle may carry several tags). */
  perTag: Map<PuzzleTag, number>;
  /** Puzzles that received at least one tag. */
  taggedPuzzles: number;
  /** Rows that could not be re-tagged (malformed/legacy: no pieces or no combos). */
  failures: number;
}

/**
 * Recompute every row's tags from its STORED data (#83), purely — no DB, no
 * engine. Each row's tags come from {@link tagPuzzle} over its decoded board,
 * pieces, and stored combo table. Rows with invalid pieces or no combo entries
 * are counted as failures and skipped (no update). Deterministic and idempotent:
 * the same rows always yield the same `updates`.
 */
export function computeRetag(rows: readonly BankRow[]): RetagResult {
  const updates: { id: string; tags: PuzzleTag[] }[] = [];
  const perTag = new Map<PuzzleTag, number>();
  let taggedPuzzles = 0;
  let failures = 0;

  for (const row of rows) {
    const entries = row.combos?.entries ?? [];
    if (!isPiece(row.piece1) || !isPiece(row.piece2) || entries.length === 0) {
      failures++;
      continue;
    }
    const tags = tagPuzzle(
      decodeBoard(row.board),
      row.piece1 as Piece,
      row.piece2 as Piece,
      entries[0],
      row.combos ?? undefined,
    );
    if (tags.length > 0) taggedPuzzles++;
    for (const tag of tags) perTag.set(tag, (perTag.get(tag) ?? 0) + 1);
    updates.push({ id: row.id, tags });
  }

  return { updates, perTag, taggedPuzzles, failures };
}

/** Stable per-tag tally over the bank (sorted by tag for a readable report). */
function reportCounts(perTag: Map<PuzzleTag, number>, taggedPuzzles: number, total: number): void {
  console.log(`\nper-tag counts (a puzzle may carry several tags):`);
  const tags = [...perTag.keys()].sort();
  if (tags.length === 0) console.log('  (none)');
  for (const tag of tags) console.log(`  ${tag.padEnd(24)} ${perTag.get(tag)}`);
  console.log(`tagged puzzles: ${taggedPuzzles}/${total} (untagged: ${total - taggedPuzzles})`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL + service key required');
  if (!databaseUrl && !dryRun) throw new Error('DATABASE_URL required for the backup DDL');
  const date = process.env.RETAG_DATE ?? '20260624';

  if (!dryRun) {
    backupBank(databaseUrl!, `puzzles_bak_${date}_retag`);
    pruneOldBackups(databaseUrl!);
  }

  const client = createSupabaseClient(supabaseUrl, serviceKey);
  // Page past PostgREST's default 1000-row cap, or a bank over 1000 puzzles would
  // be silently truncated and the tail never re-tagged.
  const PAGE = 1000;
  const rows: BankRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('puzzles')
      .select('id, board, piece1, piece2, combos, tags')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read puzzles failed: ${error.message}`);
    const batch = (data ?? []) as BankRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  console.log(`re-tagging ${rows.length} puzzles${dryRun ? ' (dry run)' : ''}…`);

  const { updates, perTag, taggedPuzzles, failures } = computeRetag(rows);
  let updated = 0;
  let writeFailures = 0;

  if (!dryRun) {
    for (const { id, tags } of updates) {
      const { error: upErr } = await client.from('puzzles').update({ tags }).eq('id', id);
      if (upErr) {
        console.error(`update ${id} failed: ${upErr.message}`);
        writeFailures++;
        continue;
      }
      updated++;
    }
  } else {
    updated = updates.length;
  }

  reportCounts(perTag, taggedPuzzles, rows.length);
  console.log(
    `${dryRun ? 'would update' : 'updated'}: ${updated}; ` +
      `skipped (legacy/malformed): ${failures}; write failures: ${writeFailures}`,
  );
}

// Run only when executed directly (not when imported by the test for the pure
// `computeRetag` core), so importing this module never reaches for env / a DB.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
