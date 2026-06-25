/**
 * Quick verification: load inserted T-spin puzzles and confirm they're valid.
 *
 * Run:
 *   NODE_OPTIONS="--experimental-websocket" npx tsx generator/src/spin-verify.ts
 */

import { pathToFileURL } from 'node:url';
import { decodeBoard, maneuver, boardMetrics } from '@trainer/core';
import { restingLineForEntry, lockAndClear } from '@trainer/core';
import { createSupabaseClient, createDataAccess } from '@trainer/data';

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) throw new Error('SUPABASE_URL + key required');

  const client = createSupabaseClient(supabaseUrl, key);
  const db = createDataAccess(client);

  // Spot-check across piece types: L-spin, J-tuck, J-spin, T-tuck, Z-tuck,
  // S-spin, S-tuck/I-tuck, J-spin, I-tuck, I-spin, Z-spin, I-spin
  for (const num of [2342,2343,2346,2351,2356,2358,2364,2366,2380,2386,2390,2401]) {
    const p = await db.getPuzzleByNumber(num);
    if (!p) { console.log(`#${num}: NOT FOUND`); continue; }

    const grid = decodeBoard(p.board);
    const entry = p.combos.entries[0];
    const line = restingLineForEntry(grid, p.piece1, p.piece2, entry);
    if (!line) { console.log(`#${num}: line reconstruction FAILED`); continue; }

    const m1 = maneuver(grid, p.piece1, line.p1);
    const a = lockAndClear(grid, p.piece1, line.p1);
    const m2 = maneuver(a.board, p.piece2, line.p2);
    const hasTSpin =
      (m1 === 'spin' && p.piece1 === 'T') || (m2 === 'spin' && p.piece2 === 'T');

    const bm = boardMetrics(grid);
    const maxH = Math.max(...bm.columnHeights);

    console.log(
      `#${num}: ${p.piece1}(${m1})+${p.piece2}(${m2})` +
        ` | T-spin=${hasTSpin ? 'YES' : 'no'}` +
        ` | tags=[${p.tags.join(', ')}]` +
        ` | combos=${p.combos.entries.length}/${p.combos.total}` +
        ` | board: holes=${bm.holes} maxH=${maxH} bump=${bm.bumpiness}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
