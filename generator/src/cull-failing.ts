/**
 * Cull (soft-delete, active=false) every ACTIVE puzzle that fails the BetaTetris
 * 7/7 consensus, per engines/betatetris/active_verdict.json (from consensus.py).
 * Reversible (#72: flip active back to true); the culled id/number/reason list is
 * saved to engines/betatetris/culled_ids.json. Loads creds from repo-root .env.
 *
 *   npx tsx generator/src/cull-failing.ts [--dry-run]
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient } from '@trainer/data';

const dryRun = process.argv.includes('--dry-run');
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!service) throw new Error('SUPABASE_SERVICE_ROLE_KEY required to cull');
const client = createSupabaseClient(process.env.SUPABASE_URL!, service);

const BT = join(root, 'engines', 'betatetris');
const verdicts: any[] = JSON.parse(readFileSync(join(BT, 'active_verdict.json'), 'utf8'));
const failing = verdicts.filter((v) => !v.keep);
const byReason: Record<string, number> = {};
for (const v of failing) byReason[v.reason ?? 'unknown'] = (byReason[v.reason ?? 'unknown'] ?? 0) + 1;
const kept = verdicts.length - failing.length;
console.log(`verdicts: ${verdicts.length}  KEEP(7/7): ${kept}  FAIL: ${failing.length}`);
console.log(`fail reasons:`, byReason);

const ids = failing.map((v) => v.id).filter(Boolean);
writeFileSync(join(BT, 'culled_ids.json'), JSON.stringify({ ids, numbers: failing.map((v) => v.number), byReason }, null, 2));
console.log(`wrote culled id/number list (${ids.length} ids) to engines/betatetris/culled_ids.json`);

if (dryRun) {
  console.log(`\n--dry-run: would set active=false on ${ids.length} puzzles (would leave ${kept} active)`);
} else {
  let updated = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client.from('puzzles').update({ active: false }).in('id', ids.slice(i, i + 200)).select('id');
    if (error) throw new Error(error.message);
    updated += (data ?? []).length;
  }
  console.log(`set active=false on ${updated} puzzles`);
}
