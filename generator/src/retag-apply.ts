/**
 * Re-tag every puzzle from its stored board + combos using the (now extended)
 * tagPuzzle — reusing retag.ts's pure `computeRetag` core. Backs up current
 * (id,tags) to engines/betatetris/tags_backup.json (no psql needed), writes the
 * recomputed tags, and reports the per-tag distribution over ACTIVE puzzles (the
 * live state). Loads creds from repo-root .env.
 *
 *   npx tsx generator/src/retag-apply.ts [--dry-run]
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient } from '@trainer/data';
import { computeRetag, type BankRow } from './retag.js';

const dryRun = process.argv.includes('--dry-run');
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!service) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
const client = createSupabaseClient(process.env.SUPABASE_URL!, service);

// pull every puzzle (paginated) with the fields computeRetag needs + active status
const rows: (BankRow & { number: number; active: boolean })[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await client
    .from('puzzles')
    .select('id, number, board, piece1, piece2, combos, tags, active')
    .order('number', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...((data ?? []) as any[]));
  if (!data || data.length < 1000) break;
}
const activeById = new Map(rows.map((r) => [r.id, r.active]));
console.log(`pulled ${rows.length} puzzles (${rows.filter((r) => r.active).length} active)`);

const BT = join(root, 'engines', 'betatetris');
writeFileSync(join(BT, 'tags_backup.json'), JSON.stringify(rows.map((r) => ({ id: r.id, tags: r.tags, active: r.active }))));
console.log(`backed up current tags → engines/betatetris/tags_backup.json`);

const { updates, failures } = computeRetag(rows);
let updated = 0;
if (!dryRun) {
  for (const { id, tags } of updates) {
    const { error } = await client.from('puzzles').update({ tags }).eq('id', id);
    if (error) { console.error(`update ${id}: ${error.message}`); continue; }
    updated++;
  }
} else {
  updated = updates.length;
}

// report: per-tag counts over ACTIVE puzzles only (the live state)
const activeTag: Record<string, number> = {};
let activeTagged = 0;
let activeTotal = 0;
for (const { id, tags } of updates) {
  if (!activeById.get(id)) continue;
  activeTotal++;
  if (tags.length) activeTagged++;
  for (const t of tags) activeTag[t] = (activeTag[t] ?? 0) + 1;
}
console.log(`\n${dryRun ? 'would update' : 'updated'} ${updated} rows; skipped (legacy/malformed) ${failures}`);
console.log(`\n=== ACTIVE puzzle tag distribution (${activeTotal} active) ===`);
for (const [t, n] of Object.entries(activeTag).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(22)} ${n}`);
console.log(`  (active puzzles with ≥1 tag: ${activeTagged}/${activeTotal})`);
