/**
 * Hand-built T-spin-double puzzle: a legal board where placing piece 1 (O, a
 * non-T/I piece) cleanly and then SPINNING the T (piece 2) into a roofed slot
 * clears TWO lines — unambiguously the best move. Verifies legality + that the
 * spin is reachable/classified in the core model, prints the boards and the
 * outcome keys for a consensus check.
 *
 *   npx tsx generator/src/tspin-puzzle.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeBoard,
  enumerateResting,
  applyRestingPlacement,
  boardKey,
  maneuver,
  type Grid,
  type Piece,
  type RestingPlacement,
} from '@trainer/core';
import { StackRabbitClient } from './engine/index.js';
import { sweepCombos, rankCombosBySanity, type ComboContext } from './pipeline/combo.js';

// board0 (rows 0..19, top→bottom). Only rows 17–19 carry blocks; a roof at
// (17,5) covers (18,5) so the T can't hard-drop in — it must spin.
const rows = [
  ...Array<string>(17).fill('0000000000'),
  '0010011111', // r17: col2 + roof(col5) + cols6-9
  '1110001111', // r18: cols0,1,2 + cols6-9   (T bar slot = cols 3,4,5)
  '1111011111', // r19: all but col4           (T stem slot = col4)
];
const board0 = decodeBoard(rows.join(''));
const PIECE1: Piece = 'O';
const PIECE2: Piece = 'T';

const cells = (b: Grid) => b.reduce((n, r) => n + r.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
const fullRows = (b: Grid) => b.filter((r) => r.every((c) => c)).length;
const render = (b: Grid) =>
  b.map((row, r) => (row.some((x) => x) ? `  r${String(r).padStart(2)} ${row.map((x) => (x ? '█' : '·')).join('')}` : null))
    .filter(Boolean)
    .join('\n');

console.log('=== board0 ===');
console.log(render(board0));
console.log(`cells=${cells(board0)} (even=${cells(board0) % 2 === 0}), fullRows=${fullRows(board0)} → legal=${cells(board0) % 2 === 0 && fullRows(board0) === 0}`);

// piece 1: O into the clean 2-wide notch at cols 0,1 (rests rows 16,17).
const o = enumerateResting(board0, PIECE1).find((p) => p.col === 0 && p.row === 16);
if (!o) throw new Error('expected O resting at cols 0,1 not found');
const board1 = applyRestingPlacement(board0, PIECE1, o);
console.log('\n=== after piece 1 (O at cols 0,1) ===');
console.log(render(board1));
const p1_key = boardKey(board1);

// piece 2: find the T placement that clears TWO lines and is a SPIN.
let best: { p: RestingPlacement; man: string; board2: Grid } | null = null;
for (const p of enumerateResting(board1, PIECE2)) {
  const board2 = applyRestingPlacement(board1, PIECE2, p);
  const cleared = (cells(board1) + 4 - cells(board2)) / 10;
  if (cleared === 2) {
    best = { p, man: maneuver(board1, PIECE2, p), board2 };
    break;
  }
}
if (!best) {
  console.log('\n!!! No 2-line-clearing T placement is reachable in the core model.');
  console.log('    (the spin geometry needs adjusting so reachableStates can rotate the T in)');
} else {
  console.log(`\n=== after piece 2 (T) — clears 2 lines, maneuver = ${best.man} ===`);
  console.log(`T resting placement: rotation=${best.p.rotation} row=${best.p.row} col=${best.p.col}`);
  console.log(render(best.board2));
  const full_key = boardKey(best.board2);
  console.log(`\np1_key  = ${p1_key}`);
  console.log(`full_key= ${full_key}`);

  // write a one-puzzle consensus keyfile for BetaTetris (consensus.py)
  const here = dirname(fileURLToPath(import.meta.url));
  const BT = join(here, '..', '..', 'engines', 'betatetris');
  const puzzle = {
    number: 99001,
    id: 'tspin-handmade-0001',
    board: rows.join(''),
    piece1: PIECE1,
    piece2: PIECE2,
    p1_key,
    full_key,
    accept_count: 1,
    margin: 0,
    tags: ['t-spin', 'spin'],
  };
  writeFileSync(join(BT, 'tspin_keys.json'), JSON.stringify([puzzle]));
  console.log(`\nwrote ${join(BT, 'tspin_keys.json')} (run consensus.py on it for BetaTetris)`);

  // StackRabbit: sweep all O×T combos and see where the T-spin-double ranks.
  const engine = new StackRabbitClient({ baseUrl: 'http://127.0.0.1:3000' });
  if (await engine.ping()) {
    for (const timeline of ['X.....', 'X.']) {
      const ctx: ComboContext = { board: board0, piece1: PIECE1, piece2: PIECE2, level: 18, lines: 0 };
      const combos = await sweepCombos(engine, ctx, timeline);
      const ranked = rankCombosBySanity(combos);
      const idx = ranked.findIndex((c) => c.boardKey === full_key);
      console.log(`\n[SR timeline='${timeline}'] swept ${ranked.length} combos; T-spin-double rank = ${idx === -1 ? 'UNREACHABLE/not found' : idx + 1}`);
      if (idx >= 0) {
        const top = ranked[0];
        console.log(`   rank-1 value=${top.value.toFixed(2)} key match=${top.boardKey === full_key}`);
        console.log(`   T-spin-double value=${ranked[idx].value.toFixed(2)}`);
      }
    }
  } else {
    console.log('\n(StackRabbit not running — skipped SR sweep)');
  }
}
