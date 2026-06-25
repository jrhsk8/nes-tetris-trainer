/**
 * Scan the live bank for MALFORMED boards: a board0 with an ODD number of filled
 * cells is impossible in legal NES play (every tetromino is 4 cells, every line
 * clear removes 10 — both even — so a legal board always has an even cell count).
 * BetaTetris's Reset rejects these as "odd-parity". Lists them, renders a few to
 * confirm the malformation, and backs up the FULL rows to a local JSON so the
 * delete is reversible.
 *
 * Read-only (no writes); loads creds from repo-root .env (never printed).
 *   npx tsx generator/src/malformed-scan.ts
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient } from '@trainer/data';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  if (!process.env[t.slice(0, i).trim()])
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const client = createSupabaseClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
);

const cells = (b: string) => (b.match(/1/g) ?? []).length;

// scan: minimal columns over the whole bank
const scan: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await client
    .from('puzzles')
    .select('id, number, board, piece1, piece2, tags, created_at')
    .order('number', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  scan.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
console.log(`scanned ${scan.length} puzzles`);

const malformed = scan.filter((r) => cells(r.board) % 2 === 1);
const SP = ['tuck', 'spin', 't-spin', 'spintuck'];
const special = malformed.filter((r) => (r.tags ?? []).some((t: string) => SP.includes(t)));
console.log(`MALFORMED (odd cell count): ${malformed.length}`);
console.log(`  of which tuck/spin/t-spin tagged: ${special.length}`);
console.log(`  non-special malformed: ${malformed.length - special.length}`);

// creation-day + tag spread of the malformed set
const byDay: Record<string, number> = {};
const byTag: Record<string, number> = {};
for (const r of malformed) {
  byDay[(r.created_at ?? '').slice(0, 10)] = (byDay[(r.created_at ?? '').slice(0, 10)] ?? 0) + 1;
  for (const t of r.tags ?? []) byTag[t] = (byTag[t] ?? 0) + 1;
}
console.log(`  by creation day:`, byDay);
console.log(`  by tag:`, byTag);

// render the first 3 to SEE the malformation
function render(b: string): string {
  const rows: string[] = [];
  for (let r = 0; r < 20; r++) {
    const row = b.slice(r * 10, r * 10 + 10);
    if (row.includes('1')) rows.push(`  r${String(r).padStart(2)} ${row.replace(/0/g, '·').replace(/1/g, '█')}`);
  }
  return rows.join('\n');
}
console.log(`\n=== sample malformed boards ===`);
for (const r of malformed.slice(0, 3)) {
  console.log(`#${r.number} ${r.piece1}+${r.piece2} cells=${cells(r.board)} (ODD) [${(r.tags ?? []).join(',')}]`);
  console.log(render(r.board));
  console.log();
}

// back up FULL rows for the malformed set (reversible delete)
const ids = malformed.map((r) => r.id);
const backup: any[] = [];
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await client.from('puzzles').select('*').in('id', ids.slice(i, i + 200));
  if (error) throw new Error(error.message);
  backup.push(...(data ?? []));
}
const backupPath = join(root, 'engines', 'betatetris', 'malformed_backup.json');
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
writeFileSync(
  join(root, 'engines', 'betatetris', 'malformed_ids.json'),
  JSON.stringify({ ids, numbers: malformed.map((r) => r.number) }, null, 2),
);
console.log(`backed up ${backup.length} full rows to ${backupPath}`);
console.log(`wrote id/number list to engines/betatetris/malformed_ids.json`);
