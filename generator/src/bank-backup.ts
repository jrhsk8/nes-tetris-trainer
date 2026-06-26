/**
 * Shared bank-snapshot helpers for the destructive generator migrations
 * (reband / retag / additive-bank). Each of those backs the live `puzzles`
 * bank up to a dated `puzzles_bak_<date>...` table before mutating it; this
 * module is the one place that creates those snapshots and prunes the stale
 * ones, so the backup tables stop accumulating forever (they were cleaned out
 * by hand once — see .claude/docs/decisions.md). Offline / generator-only;
 * uses `psql` for the DDL, like the call sites it replaces.
 */

import { spawnSync } from 'node:child_process';

function runPsql(databaseUrl: string, sql: string): { status: number; out: string } {
  const res = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`psql failed: ${res.stderr || res.stdout || res.error?.message}`);
  }
  return { status: res.status ?? 0, out: res.stdout ?? '' };
}

/** Snapshot the live `puzzles` bank to a dated backup table (idempotent). */
export function backupBank(databaseUrl: string, table: string): void {
  runPsql(databaseUrl, `create table if not exists public.${table} as select * from public.puzzles;`);
  console.log(`backed up bank → ${table}`);
}

const SNAPSHOT_PREFIX = /^(puzzles|attempts|user_ratings)_bak_/;
const DATE_STAMP = /(\d{8})/; // the YYYYMMDD the migrations stamp into the name

/**
 * Drop `*_bak_*` snapshot tables whose embedded YYYYMMDD stamp is older than
 * `keepDays` days, so the dated backups don't pile up indefinitely. Safe by
 * construction: only ever considers tables matching the snapshot prefixes
 * (`puzzles_bak_` / `attempts_bak_` / `user_ratings_bak_`), and only those
 * carrying a parseable 8-digit date — anything undatable (e.g. `*_bak_e41`) is
 * left untouched. Best-effort: logs what it drops, never throws on a miss.
 */
export function pruneOldBackups(databaseUrl: string, keepDays = 14): void {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000);
  const cutoffInt =
    cutoff.getUTCFullYear() * 10000 + (cutoff.getUTCMonth() + 1) * 100 + cutoff.getUTCDate();

  const { out } = runPsql(
    databaseUrl,
    `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE';`,
  );
  const stale = out
    .split('\n')
    .map((s) => s.trim())
    .filter((name) => SNAPSHOT_PREFIX.test(name))
    .filter((name) => {
      const m = name.match(DATE_STAMP);
      return m != null && Number(m[1]) < cutoffInt;
    });

  if (stale.length === 0) {
    console.log(`no backup snapshots older than ${keepDays}d to prune`);
    return;
  }
  const drops = stale.map((t) => `drop table if exists public."${t}";`).join('\n');
  runPsql(databaseUrl, drops);
  console.log(`pruned ${stale.length} backup snapshot(s) older than ${keepDays}d: ${stale.join(', ')}`);
}
