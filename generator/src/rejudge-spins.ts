/**
 * Re-judge the CULLED tuck/spin/t-spin puzzles with the FIXED consensus keys.
 *
 * The original cull keyed off `bt-bank-keys.ts`, which (like the old
 * `consensusKeys`) hard-dropped the maneuver piece — the WRONG board for a
 * tuck/spin — so every maneuver puzzle spuriously "disagreed". This re-runs the
 * BetaTetris 7/7 consensus through the now-fixed `filterByConsensus`
 * (`consensusKeys` reconstructs the true resting line from the combo boardKey),
 * and with `--restore` un-culls (active=true) the ones that genuinely pass.
 *
 * Creds from repo-root .env; StackRabbit not needed (consensus is BT-only).
 *   npx tsx generator/src/rejudge-spins.ts [--restore]
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient } from '@trainer/data';
import { filterByConsensus, type ConsensusJudge, type ConsensusPuzzle } from './pipeline/consensus.js';

const restore = process.argv.includes('--restore');
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const client = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const BT = join(root, 'engines', 'betatetris');
const btEnv = { ...process.env, BT_HOME: BT + '\\', BT_REPO_PY: join(BT, 'betatetris-tablebase', 'python'), BT_MODELS: join(BT, 'models'), BT_OUT: BT + '\\' };
const judge: ConsensusJudge = async (rows) => {
  const dir = mkdtempSync(join(tmpdir(), 'rejudge-'));
  const inP = join(dir, 'k.json'), outP = join(dir, 'v.json');
  writeFileSync(inP, JSON.stringify(rows));
  await new Promise<void>((res, rej) => { const c = spawn('python', [join(BT, 'consensus.py'), inP, outP], { env: btEnv, stdio: ['ignore', 'ignore', 'inherit'] }); c.on('error', rej); c.on('close', (code) => (code === 0 ? res() : rej(new Error('consensus exit ' + code)))); });
  const v = JSON.parse(readFileSync(outP, 'utf8')) as any[];
  const byId = new Map(v.map((x) => [x.id, x]));
  return rows.map((r) => byId.get(r.id));
};

const SP = ['tuck', 'spin', 't-spin', 'spintuck'];
// pull INACTIVE puzzles tagged tuck/spin/t-spin (paginated)
const rows: any[] = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await client
    .from('puzzles')
    .select('id, number, board, piece1, piece2, optimal_line, combos, tags')
    .eq('active', false)
    .overlaps('tags', SP)
    .order('number', { ascending: true })
    .range(f, f + 999);
  if (error) throw new Error(error.message);
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const cells = (b: string) => (b.match(/1/g) ?? []).length;
const legal = rows.filter((r) => cells(r.board) % 2 === 0); // skip odd-parity (malformed) — BT can't judge
console.log(`culled tuck/spin/t-spin: ${rows.length} (legal: ${legal.length}, malformed/odd-parity skipped: ${rows.length - legal.length})`);

const puzzles: (ConsensusPuzzle & { id: string })[] = legal.map((r) => ({
  id: r.id,
  number: r.number,
  board: r.board,
  piece1: r.piece1,
  piece2: r.piece2,
  optimalLine: r.optimal_line,
  combos: r.combos,
}));

const result = await filterByConsensus(puzzles, judge);
console.log(`\n=== re-judged with FIXED keys (combo boardKey) ===`);
console.log(`PASS 7/7: ${result.kept.length}/${puzzles.length} (was 0 with the buggy hard-drop keys)`);
const reasons: Record<string, number> = {};
for (const d of result.dropped) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
console.log(`still failing:`, reasons);

// tag breakdown of the now-passing ones
const tagBy = new Map(legal.map((r) => [r.id, r.tags as string[]]));
const passTags: Record<string, number> = {};
for (const p of result.kept) for (const t of tagBy.get(p.id) ?? []) if (SP.includes(t)) passTags[t] = (passTags[t] ?? 0) + 1;
console.log(`now-passing by maneuver tag:`, passTags);

const restoreIds = result.kept.map((p) => p.id);
writeFileSync(join(BT, 'rejudge_pass_ids.json'), JSON.stringify({ ids: restoreIds, numbers: result.kept.map((p) => p.number) }, null, 2));

if (restore && restoreIds.length) {
  let updated = 0;
  for (let i = 0; i < restoreIds.length; i += 200) {
    const { data, error } = await client.from('puzzles').update({ active: true }).in('id', restoreIds.slice(i, i + 200)).select('id');
    if (error) throw new Error(error.message);
    updated += (data ?? []).length;
  }
  console.log(`\nRESTORED (active=true) ${updated} puzzles that genuinely pass 7/7`);
} else if (restoreIds.length) {
  console.log(`\n(${restoreIds.length} would be restored — re-run with --restore to un-cull them)`);
}
