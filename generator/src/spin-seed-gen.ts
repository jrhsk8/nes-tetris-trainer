/**
 * Constructive tuck/spin SEED generator (#follow-up to the parity work).
 *
 * Instead of sweeping random self-play boards and hoping a tuck/spin happens to
 * be StackRabbit's eval-best (which yields engine-DISAGREED quirks — 0/115 passed
 * consensus), we CONSTRUCT boards where a tuck/spin is *forced* to be the best
 * move: a roofed slot only a spin can fill, completing multiple line clears. Then
 * we verify each against BOTH engines (StackRabbit rank-1 + BetaTetris keep) and
 * keep only the agreed ones.
 *
 * Variety is the point: every construction randomizes the slot column, the roof
 * side, the piece-1 gap column, the piece-1 type, the clear count, and the
 * surrounding skyline — and a per-column cap stops the same spin landing in the
 * same spot repeatedly.
 *
 *   npx tsx generator/src/spin-seed-gen.ts [count]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyBoard,
  encodeBoard,
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

const randInt = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: readonly T[]): T => a[randInt(a.length)];
export const cellCount = (b: Grid) => b.reduce((n, r) => n + r.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
export const fullRows = (b: Grid) => b.filter((r) => r.every((c) => c)).length;
export const render = (b: Grid) =>
  b.map((row, r) => (row.some((x) => x) ? `  r${String(r).padStart(2)} ${row.map((x) => (x ? '█' : '·')).join('')}` : null))
    .filter(Boolean)
    .join('\n');

export interface Construction {
  kind: string;
  board: Grid;
  piece1: Piece;
  piece2: Piece;
  slotCol: number; // for the per-column variety cap
}

/**
 * Forced T-spin DOUBLE. Bottom two rows are full except the T-slot (bar cols
 * c-1,c,c+1 / stem col c) and a 2×2 piece-1 gap (cols g,g+1). A roof block above
 * one bar end forces the spin (no hard-drop). Both rows complete only after O
 * fills its gap AND the T spins in — so the combo is the unique line-clear.
 */
export function constructTSpinDouble(): Construction | null {
  const c = 1 + randInt(8); // stem col 1..8
  const roofSide = Math.random() < 0.5 ? 'L' : 'R';
  const roofCol = roofSide === 'R' ? c + 1 : c - 1;
  const slot = new Set([c - 1, c, c + 1]);

  // piece-1 gap cols {g,g+1}, disjoint from the slot
  const gOpts: number[] = [];
  for (let g = 0; g < 9; g++) if (!slot.has(g) && !slot.has(g + 1)) gOpts.push(g);
  if (!gOpts.length) return null;
  const g = pick(gOpts);

  // columns that must stay OPEN above the slot (T entry / O drop): the two
  // non-roof bar cols + the gap cols. (The roof col carries the overhang.)
  const open = new Set<number>([...slot, g, g + 1]);
  open.delete(roofCol);

  const board = emptyBoard();
  for (let col = 0; col < 10; col++) {
    if (col !== c && col !== g && col !== g + 1) board[19][col] = 1; // stem + gap empty
    if (!slot.has(col) && col !== g && col !== g + 1) board[18][col] = 1; // bar + gap empty
  }
  board[17][roofCol] = 1; // the roof (overhang) → forces the spin

  // varied skyline on the non-open, non-roof columns
  for (let col = 0; col < 10; col++) {
    if (open.has(col) || col === roofCol) continue;
    const h = randInt(4); // 0..3 extra rows
    for (let k = 0; k < h; k++) if (17 - k >= 0) board[17 - k][col] = 1;
  }
  return { kind: 'tspin-double', board, piece1: 'O', piece2: 'T', slotCol: c };
}

/** Verified construction with its outcome keys + placements. */
export interface Verified extends Construction {
  p1: RestingPlacement;
  p2: RestingPlacement;
  p1_key: string;
  full_key: string;
  clears: number;
  man2: string;
}

/**
 * Confirm in the core model: legal board, piece-1 hard-drops into its gap, and
 * piece-2 SPINS/tucks in to clear ≥2 lines. Returns the keys, or null if the
 * geometry isn't reachable in the maneuver model.
 */
export function coreVerify(con: Construction): Verified | null {
  const { board, piece1, piece2 } = con;
  if (cellCount(board) % 2 !== 0 || fullRows(board) > 0) return null;
  // piece 1: deepest resting placement (it drops into its open gap)
  const p1s = enumerateResting(board, piece1);
  let p1: RestingPlacement | null = null;
  // prefer a placement that adds no holes and sits low; just try each and require
  // the eventual 2-line clear with piece 2.
  for (const cand of p1s.sort((a, b) => b.row - a.row)) {
    const board1 = applyRestingPlacement(board, piece1, cand);
    for (const p of enumerateResting(board1, piece2)) {
      const b2 = applyRestingPlacement(board1, piece2, p);
      const clears = (cellCount(board1) + 4 - cellCount(b2)) / 10;
      const man = maneuver(board1, piece2, p);
      if (clears >= 2 && (man === 'spin' || man === 'tuck')) {
        p1 = cand;
        return {
          ...con,
          p1: cand,
          p2: p,
          p1_key: boardKey(board1),
          full_key: boardKey(b2),
          clears,
          man2: man,
        };
      }
    }
    void p1;
  }
  return null;
}

/**
 * Forced TUCK. A lip (overhang) at (17,k) covers a cavity below it; the bottom
 * two rows are full except that cavity and a piece-1 gap. A non-T piece must
 * slide laterally UNDER the lip (it cannot hard-drop straight in) to fill the
 * cavity and complete two lines. We try each of S/Z/L/J and keep whichever
 * actually tucks in the core model (coreVerify confirms maneuver==='tuck').
 */
function constructTuck(): Construction | null {
  // An S/Z piece has a 2-row "step" shape that slides under an overhang. Carve
  // its footprint into the bottom two rows and roof the far end so a straight
  // hard-drop is blocked — the piece must shift sideways under the overhang.
  const variant: Piece = Math.random() < 0.5 ? 'S' : 'Z';
  const C = 1 + randInt(6); // base col (needs C+2 ≤ 9)
  // S cells: top (18,C+1),(18,C+2) / bottom (19,C),(19,C+1); roof over C+2.
  // Z cells: top (18,C),(18,C+1)   / bottom (19,C+1),(19,C+2); roof over C.
  const top = variant === 'S' ? [C + 1, C + 2] : [C, C + 1];
  const bot = variant === 'S' ? [C, C + 1] : [C + 1, C + 2];
  const overCol = variant === 'S' ? C + 2 : C;
  const entry = variant === 'S' ? [C, C + 1] : [C + 1, C + 2];
  const slot = new Set([...top, ...bot]);

  const gOpts: number[] = [];
  for (let g = 0; g < 9; g++) if (![g, g + 1].some((x) => slot.has(x))) gOpts.push(g);
  if (!gOpts.length) return null;
  const g = pick(gOpts);
  const open = new Set<number>([...entry, g, g + 1]);

  const board = emptyBoard();
  for (let col = 0; col < 10; col++) {
    if (!top.includes(col) && col !== g && col !== g + 1) board[18][col] = 1;
    if (!bot.includes(col) && col !== g && col !== g + 1) board[19][col] = 1;
  }
  board[17][overCol] = 1; // overhang → forces the lateral tuck
  for (let col = 0; col < 10; col++) {
    if (open.has(col) || col === overCol) continue;
    const h = randInt(3);
    for (let j = 0; j < h; j++) if (17 - j >= 0) board[17 - j][col] = 1;
  }
  const con: Construction = { kind: `tuck-${variant}`, board, piece1: 'O', piece2: variant, slotCol: C };
  return coreVerify(con) ? con : null;
}

// constructTuck is kept but not yet active: my hand-derived S/Z step slots aren't
// classified as reachable tucks by the core maneuver model. A working tuck shape
// is best templated from a real bank tuck (e.g. #1245) — a follow-up. The T-spin
// double already gives strong variety (slot column, roof side, gap, skyline).
void constructTuck;
const CONSTRUCTORS = [constructTSpinDouble];
const TIMELINE = 'X.....';

async function main() {
  const target = Number(process.argv[2] ?? 16);
  const seen = new Set<string>();
  const perCol = new Map<number, number>();
  const core: Verified[] = [];
  let tries = 0;
  while (core.length < target && tries < target * 300) {
    tries++;
    const con = pick(CONSTRUCTORS)();
    if (!con) continue;
    const v = coreVerify(con);
    if (!v) continue;
    const key = encodeBoard(v.board);
    if (seen.has(key)) continue; // exact-dup
    if ((perCol.get(v.slotCol) ?? 0) >= 3) continue; // variety cap per slot column
    seen.add(key);
    perCol.set(v.slotCol, (perCol.get(v.slotCol) ?? 0) + 1);
    core.push(v);
  }
  console.log(`core-valid constructions: ${core.length} (in ${tries} tries)`);
  const kinds: Record<string, number> = {};
  for (const v of core) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
  console.log(`by kind:`, kinds);
  console.log(`slot-column spread:`, [...perCol.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `c${k}:${n}`).join(' '));

  // StackRabbit: keep only constructions where the forced spin is the rank-1 combo.
  const engine = new StackRabbitClient({ baseUrl: 'http://127.0.0.1:3000' });
  if (!(await engine.ping())) {
    console.log('\n(StackRabbit not running — skipping engine verification)');
    return;
  }
  const srAgreed: Verified[] = [];
  for (const v of core) {
    const ctx: ComboContext = { board: v.board, piece1: v.piece1, piece2: v.piece2, level: 18, lines: 0 };
    const ranked = rankCombosBySanity(await sweepCombos(engine, ctx, TIMELINE));
    const rank = ranked.findIndex((c) => c.boardKey === v.full_key) + 1;
    if (rank === 1) srAgreed.push(v);
  }
  console.log(`StackRabbit rank-1 (spin is SR's best): ${srAgreed.length}/${core.length}`);

  // write a keyfile for the BetaTetris consensus check (consensus.py)
  const here = dirname(fileURLToPath(import.meta.url));
  const BT = join(here, '..', '..', 'engines', 'betatetris');
  const keyfile = srAgreed.map((v, i) => ({
    number: 99100 + i,
    id: `seed-${v.kind}-${i}`,
    board: encodeBoard(v.board),
    piece1: v.piece1,
    piece2: v.piece2,
    p1_key: v.p1_key,
    full_key: v.full_key,
    accept_count: 1,
    margin: 0,
    tags: v.man2 === 'spin' ? ['t-spin', 'spin'] : ['tuck'],
  }));
  writeFileSync(join(BT, 'seed_keys.json'), JSON.stringify(keyfile));
  console.log(`wrote ${keyfile.length} SR-agreed puzzles to engines/betatetris/seed_keys.json`);
  console.log(`→ run: bt-run python engines/betatetris/consensus.py engines/betatetris/seed_keys.json engines/betatetris/seed_verdict.json`);

  for (const v of srAgreed.slice(0, 6)) {
    console.log(`\n--- ${v.kind} slotCol=${v.slotCol} ${v.piece1}+${v.piece2} clears=${v.clears} maneuver=${v.man2} ---`);
    console.log(render(v.board));
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
