// Build engines/betatetris/active_keys.json = bank_keys.json filtered to ACTIVE
// puzzles only (so the consensus cull judges only live puzzles). Read-only pull.
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient } from '@trainer/data';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const client = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!);

const activeNums = new Set<number>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await client.from('puzzles').select('number, active').eq('active', true).order('number', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) activeNums.add(r.number);
  if (!data || data.length < 1000) break;
}

const BT = join(root, 'engines', 'betatetris');
const bank: any[] = JSON.parse(readFileSync(join(BT, 'bank_keys.json'), 'utf8'));
const active = bank.filter((r) => activeNums.has(r.number));
writeFileSync(join(BT, 'active_keys.json'), JSON.stringify(active));
console.log(`active puzzles: ${activeNums.size}; keyfile rows (with computed keys): ${active.length}`);
console.log(`(any active puzzle missing from bank_keys: ${activeNums.size - active.length})`);
