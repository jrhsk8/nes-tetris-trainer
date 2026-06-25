/**
 * #54 Phase 1 helper — export the bank's canonical outcome keys for the
 * BetaTetris keep-rate measurement (`engines/betatetris/keeprate.py`).
 *
 * For each puzzle it computes, in the *production* convention (core's
 * `applyPlacement` + `boardKey`), the board key after our stored optimal's
 * **piece-1** placement and after **both** placements. The Python side injects
 * board0 into BetaTetris, reads its piece-1 policy, and looks up where our
 * optimal piece-1 outcome sits in that policy — convention-free, because both
 * sides match by the 200-char outcome key rather than by rotation/col numbers.
 *
 * Offline / generator-only (StackRabbit guardrail). Writes `bank_keys.json`
 * into `$BT_OUT` (defaults to `$BT_HOME`).
 *
 *   npx tsx generator/src/bt-bank-keys.ts
 */

// `ws` ships no bundled type declarations in this repo (no @types/ws); it is a
// runtime-only polyfill so Node's WebSocket-less env can open the Supabase realtime
// socket. Suppress the missing-types error rather than add a dev dependency.
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPlacement, boardKey, decodeBoard, type Line } from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';
import type { PuzzleRow } from '@trainer/data';

interface BankKeyRow {
  id: string;
  number: number | null;
  board: string;
  piece1: string;
  piece2: string;
  /** Outcome key after our optimal piece-1 placement (the move BetaTetris must bless). */
  p1_key: string;
  /** Outcome key after both placements (sanity vs combos rank-1 boardKey). */
  full_key: string;
  accept_count: number | null;
  margin: number | null;
  tags: string[];
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL + service key required');
  const outDir = process.env.BT_OUT ?? process.env.BT_HOME ?? '.';

  const client = createSupabaseClient(supabaseUrl, serviceKey);
  // Paginate past Supabase's 1000-row response cap (the bank is now > 1000).
  type Row = Pick<
    PuzzleRow,
    'id' | 'number' | 'board' | 'piece1' | 'piece2' | 'optimal_line' | 'accept_count' | 'margin'
  > & { tags: string[] | null };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('puzzles')
      .select('id, number, board, piece1, piece2, optimal_line, accept_count, margin, tags')
      .order('number', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const out: BankKeyRow[] = [];
  let failed = 0;
  for (const r of rows) {
    try {
      const line = r.optimal_line as unknown as Line;
      const board0 = decodeBoard(r.board);
      const afterP1 = applyPlacement(board0, r.piece1 as never, line[0]);
      const afterP2 = applyPlacement(afterP1, r.piece2 as never, line[1]);
      out.push({
        id: String(r.id),
        number: r.number,
        board: r.board,
        piece1: r.piece1,
        piece2: r.piece2,
        p1_key: boardKey(afterP1),
        full_key: boardKey(afterP2),
        accept_count: r.accept_count ?? null,
        margin: r.margin ?? null,
        tags: r.tags ?? [],
      });
    } catch (e) {
      failed += 1;
      console.error(`puzzle #${r.number} (${r.id}) failed:`, (e as Error).message);
    }
  }

  const path = join(outDir, 'bank_keys.json');
  writeFileSync(path, JSON.stringify(out));
  console.log(`wrote ${out.length} bank keys to ${path} (${failed} failed)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
