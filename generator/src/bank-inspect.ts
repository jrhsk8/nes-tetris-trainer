/**
 * Read-only live-bank inspector: counts, max number, tag breakdown, and rows
 * created today — to see whether freshly generated tuck/spin/t-spin puzzles
 * actually landed in `public.puzzles`. Loads creds from the repo-root .env
 * (never printed). Offline / generator-only.
 *
 *   npx tsx generator/src/bank-inspect.ts
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient } from '@trainer/data';

// load repo-root .env into process.env (no printing)
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!process.env[k]) process.env[k] = v;
}

const url = process.env.SUPABASE_URL!;
const keyName = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'anon';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
const client = createSupabaseClient(url, key);

// paginate past Supabase's 1000-row cap
const rows: any[] = [];
let total = 0;
for (let from = 0; ; from += 1000) {
  const { data, error, count } = await client
    .from('puzzles')
    .select('number, piece1, piece2, tags, created_at', { count: 'exact' })
    .order('number', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  total = count ?? total;
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

console.log(`connected with ${keyName} key`);
console.log(`total puzzles (count): ${total}   (rows fetched: ${rows.length})`);
const nums = rows.map((r: any) => r.number).filter((n: any) => n != null);
console.log(`number range: ${Math.min(...nums)} … ${Math.max(...nums)}`);

// tag breakdown
const tagCount: Record<string, number> = {};
for (const r of rows as any[]) for (const t of r.tags ?? []) tagCount[t] = (tagCount[t] ?? 0) + 1;
console.log(`\ntag breakdown:`);
for (const [t, c] of Object.entries(tagCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(22)} ${c}`);
}
for (const t of ['tuck', 'spin', 't-spin', 'spintuck']) {
  if (!(t in tagCount)) console.log(`  ${t.padEnd(22)} 0  (none)`);
}

// created today (2026-06-24) or most recent
const byDay: Record<string, number> = {};
for (const r of rows as any[]) {
  const d = (r.created_at ?? '').slice(0, 10);
  byDay[d] = (byDay[d] ?? 0) + 1;
}
console.log(`\nrows by creation day (last 6):`);
for (const [d, c] of Object.entries(byDay).sort().slice(-6)) console.log(`  ${d}  ${c}`);

// the special puzzles, listed
const special = (rows as any[]).filter((r) =>
  (r.tags ?? []).some((t: string) => ['tuck', 'spin', 't-spin', 'spintuck'].includes(t)),
);
console.log(`\ntuck/spin/t-spin/spintuck puzzles in bank: ${special.length}`);
for (const r of special) {
  console.log(`  #${r.number} ${r.piece1}+${r.piece2} [${(r.tags ?? []).join(',')}] ${(r.created_at ?? '').slice(0, 10)}`);
}
