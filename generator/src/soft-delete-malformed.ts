/**
 * Soft-delete (cull, #72: set active=false) the malformed bank puzzles found by
 * malformed-scan.ts. The app's matchmaking filters `active = true`, so this stops
 * them being served while staying reversible (full rows are backed up in
 * engines/betatetris/malformed_backup.json; restore via setPuzzleActive).
 *
 * Loads creds from repo-root .env (never printed). Needs the service-role key.
 *   npx tsx generator/src/soft-delete-malformed.ts
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { readFileSync } from 'node:fs';
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
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!service) throw new Error('SUPABASE_SERVICE_ROLE_KEY required to cull puzzles');
const client = createSupabaseClient(process.env.SUPABASE_URL!, service);

const { ids, numbers } = JSON.parse(
  readFileSync(join(root, 'engines', 'betatetris', 'malformed_ids.json'), 'utf8'),
) as { ids: string[]; numbers: number[] };
console.log(`culling ${ids.length} malformed puzzles (numbers ${Math.min(...numbers)}…${Math.max(...numbers)})`);

let updated = 0;
for (let i = 0; i < ids.length; i += 200) {
  const batch = ids.slice(i, i + 200);
  const { data, error } = await client
    .from('puzzles')
    .update({ active: false })
    .in('id', batch)
    .select('id');
  if (error) throw new Error(error.message);
  updated += (data ?? []).length;
}
console.log(`set active=false on ${updated} puzzles`);

// verify: no ACTIVE puzzle has an odd cell count anymore
const stillActive: number[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await client
    .from('puzzles')
    .select('number, board, active')
    .eq('active', true)
    .order('number', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    if ((r.board.match(/1/g) ?? []).length % 2 === 1) stillActive.push(r.number);
  }
  if (!data || data.length < 1000) break;
}
console.log(`verification — active puzzles still odd-parity: ${stillActive.length}` + (stillActive.length ? ` (${stillActive.join(',')})` : ' ✓'));
