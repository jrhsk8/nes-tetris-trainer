/**
 * Gap-from-best sampler (#47). Re-runs the combo sweep against the live engine on
 * a sample of real bank puzzles and reports the raw StackRabbit eval `value` gaps
 * from rank-1 to rank-2 / 3 / 5 / 10 and to the worst legal combo. The observed
 * distribution is what `MARGIN` (the largest gap still graded correct) and `k`
 * (the display slope) are chosen from — not a guess (.claude/docs/decisions.md #47).
 *
 *   npx tsx generator/src/gap-sample.ts [sampleSize]
 */

import { decodeBoard } from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';
import type { PuzzleRow } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { sweepCombos, type ComboContext } from './pipeline/combo.js';
import { DEFAULT_GENERATION_CONFIG } from './pipeline/generate.js';

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

async function main(): Promise<void> {
  const sampleSize = Number.parseInt(process.argv[2] ?? '20', 10);
  const engineUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL + service key required');

  const engine = new StackRabbitClient({ baseUrl: engineUrl });
  if (!(await engine.ping())) throw new Error(`engine not reachable at ${engineUrl}`);
  const client = createSupabaseClient(supabaseUrl, serviceKey);

  const { data, error } = await client
    .from('puzzles')
    .select('board, piece1, piece2')
    .limit(sampleSize);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Pick<PuzzleRow, 'board' | 'piece1' | 'piece2'>[];

  const gapsTo: Record<string, number[]> = { r2: [], r3: [], r5: [], r10: [], worst: [] };
  const timeline = DEFAULT_GENERATION_CONFIG.valuationTimeline;
  let n = 0;
  for (const row of rows) {
    const ctx: ComboContext = {
      board: decodeBoard(row.board),
      piece1: row.piece1 as ComboContext['piece1'],
      piece2: row.piece2 as ComboContext['piece2'],
      level: 18,
      lines: 0,
    };
    const combos = await sweepCombos(engine, ctx, timeline);
    if (combos.length < 2) continue;
    n++;
    const best = combos[0].value;
    const gapAt = (rank: number) =>
      rank <= combos.length ? best - combos[rank - 1].value : best - combos[combos.length - 1].value;
    gapsTo.r2.push(gapAt(2));
    gapsTo.r3.push(gapAt(3));
    gapsTo.r5.push(gapAt(5));
    gapsTo.r10.push(gapAt(10));
    gapsTo.worst.push(best - combos[combos.length - 1].value);
  }

  console.log(`Sampled ${n} puzzles (raw StackRabbit eval-value gaps from rank-1):\n`);
  console.log('rank  median   p25     p75     p90     max');
  for (const key of ['r2', 'r3', 'r5', 'r10', 'worst']) {
    const s = [...gapsTo[key]].sort((a, b) => a - b);
    const fmt = (x: number) => x.toFixed(3).padStart(7);
    console.log(
      `${key.padEnd(5)}${fmt(quantile(s, 0.5))} ${fmt(quantile(s, 0.25))} ${fmt(quantile(s, 0.75))} ` +
        `${fmt(quantile(s, 0.9))} ${fmt(Math.max(...s))}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
