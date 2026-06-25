/**
 * Experiment (#55 follow-up): are BetaTetris's piece-2 disagreements actually
 * *healthier* boards than our stored optimal, or just different?
 *
 * For every disagree-p2 instance — a (puzzle, p3) where BT's rank-1 piece-2
 * board differs from our optimal's `full_key`, both built on the SAME post-piece-1
 * board — we compute @trainer/core board metrics (holes / max height / aggregate
 * height / bumpiness) on BT's board and ours and compare. If BT consistently
 * leaves fewer holes / a lower / smoother stack, that supports "BT trades the
 * immediate 2-ply eval StackRabbit maximizes for long-horizon board quality".
 *
 * Reads engines/betatetris/p2_disagree_boards.json (from p2_disagree_boards.py)
 * and puzzle_tags.json. Offline analysis only.
 *
 *   tsx generator/src/p2-health.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBoard, boardMetrics } from '@trainer/core';

const here = dirname(fileURLToPath(import.meta.url));
const BT = join(here, '..', '..', 'engines', 'betatetris');

interface P3Entry {
  p3_id: number;
  agree: boolean | null;
  bt_board: string | null;
}
interface PuzzleRec {
  number: number;
  piece1: string;
  piece2: string;
  p1_key: string;
  our_full_key: string;
  p2_agree: number;
  p3: P3Entry[];
}

const data: PuzzleRec[] = JSON.parse(readFileSync(join(BT, 'p2_disagree_boards.json'), 'utf8'));
const tagRows: { number: number; tags: string[] }[] = JSON.parse(
  readFileSync(join(BT, 'puzzle_tags.json'), 'utf8'),
);
const tagsByNum = new Map(tagRows.map((r) => [r.number, r.tags]));

function metrics(key: string) {
  const g = decodeBoard(key);
  const bm = boardMetrics(g);
  return {
    holes: bm.holes,
    agg: bm.aggregateHeight,
    bump: bm.bumpiness,
    max: bm.columnHeights.length ? Math.max(...bm.columnHeights) : 0,
    cells: (key.match(/1/g) ?? []).length,
  };
}
const cellCount = (key: string) => (key.match(/1/g) ?? []).length;

/** One BT-vs-ours board pair where BT disagreed. */
interface Instance {
  number: number;
  p2_agree: number;
  tags: string[];
  dHoles: number; // bt - ours  (negative = BT cleaner)
  dMax: number; // bt - ours  (negative = BT lower)
  dAgg: number; // bt - ours  (negative = BT lower overall)
  dBump: number; // bt - ours  (negative = BT smoother)
  btDom: boolean; // BT strictly out-cleans: fewer holes AND no taller
  ourDom: boolean; // ours strictly out-cleans
  ourLines: number; // lines our optimal cleared
  btLines: number; // lines BT's pick cleared
}

const inst: Instance[] = [];
for (const pz of data) {
  const our = metrics(pz.our_full_key);
  const p1cells = cellCount(pz.p1_key);
  const ourLines = (p1cells + 4 - our.cells) / 10;
  const tags = tagsByNum.get(pz.number) ?? [];
  for (const e of pz.p3) {
    if (e.agree !== false || !e.bt_board) continue; // only true disagreements
    const bt = metrics(e.bt_board);
    inst.push({
      number: pz.number,
      p2_agree: pz.p2_agree,
      tags,
      dHoles: bt.holes - our.holes,
      dMax: bt.max - our.max,
      dAgg: bt.agg - our.agg,
      dBump: bt.bump - our.bump,
      btDom: bt.holes < our.holes && bt.max <= our.max,
      ourDom: our.holes < bt.holes && our.max <= bt.max,
      ourLines,
      btLines: (p1cells + 4 - bt.cells) / 10,
    });
  }
}

// ---- reporting helpers ----
const N = inst.length;
const pct = (k: number) => `${k} (${((100 * k) / N).toFixed(0)}%)`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sign = (xs: number[]) => ({
  lt: xs.filter((x) => x < 0).length, // BT smaller (healthier)
  eq: xs.filter((x) => x === 0).length,
  gt: xs.filter((x) => x > 0).length, // BT larger (worse)
});

function dimLine(name: string, xs: number[]) {
  const s = sign(xs);
  return (
    `  ${name.padEnd(14)} BT-better ${String(pct(s.lt)).padEnd(12)} ` +
    `tie ${String(pct(s.eq)).padEnd(12)} BT-worse ${String(pct(s.gt)).padEnd(12)} ` +
    `mean Δ ${mean(xs).toFixed(2)}`
  );
}

console.log(`\n=== BT piece-2 disagreement board health vs our optimal ===`);
console.log(`disagreement instances: ${N}  (across ${new Set(inst.map((i) => i.number)).size} puzzles)`);
console.log(`\nPer-dimension (BT − ours; "BT-better" = BT's value is lower/healthier):`);
console.log(dimLine('holes', inst.map((i) => i.dHoles)));
console.log(dimLine('max height', inst.map((i) => i.dMax)));
console.log(dimLine('agg height', inst.map((i) => i.dAgg)));
console.log(dimLine('bumpiness', inst.map((i) => i.dBump)));

const btDom = inst.filter((i) => i.btDom).length;
const ourDom = inst.filter((i) => i.ourDom).length;
console.log(`\nHoles-dominance (the generator's own #50 sanity criterion):`);
console.log(`  BT strictly out-cleans ours (fewer holes, no taller): ${pct(btDom)}`);
console.log(`  ours strictly out-cleans BT:                          ${pct(ourDom)}`);
console.log(`  incomparable:                                         ${pct(N - btDom - ourDom)}`);

// line-clear cross-tab
const bothClear = inst.filter((i) => i.ourLines > 0 && i.btLines > 0).length;
const ourOnly = inst.filter((i) => i.ourLines > 0 && i.btLines === 0).length;
const btOnly = inst.filter((i) => i.ourLines === 0 && i.btLines > 0).length;
const neither = inst.filter((i) => i.ourLines === 0 && i.btLines === 0).length;
console.log(`\nLine clears (our optimal vs BT's pick):`);
console.log(`  both clear: ${pct(bothClear)}   ours-only: ${pct(ourOnly)}   BT-only: ${pct(btOnly)}   neither: ${pct(neither)}`);

// holes specifically when neither clears a line (isolates pure stacking shape)
const ns = inst.filter((i) => i.ourLines === 0 && i.btLines === 0);
if (ns.length) {
  const s = sign(ns.map((i) => i.dHoles));
  console.log(
    `  (no-clear subset, holes: BT-fewer ${s.lt} tie ${s.eq} BT-more ${s.gt}, mean Δ ${mean(ns.map((i) => i.dHoles)).toFixed(2)})`,
  );
}

// ---- by disagreement strength (p2_agree: 0 = BT disagrees on all 7) ----
console.log(`\nBy disagreement strength (p2_agree; 0 = BT disagrees on every p3):`);
console.log(`  agree  n    Δholes  Δmax   Δagg   Δbump  BT-dominates`);
for (let a = 0; a <= 6; a++) {
  const g = inst.filter((i) => i.p2_agree === a);
  if (!g.length) continue;
  const d = g.filter((i) => i.btDom).length;
  console.log(
    `  ${a}/7    ${String(g.length).padEnd(4)} ` +
      `${mean(g.map((i) => i.dHoles)).toFixed(2).padStart(6)} ` +
      `${mean(g.map((i) => i.dMax)).toFixed(2).padStart(6)} ` +
      `${mean(g.map((i) => i.dAgg)).toFixed(2).padStart(6)} ` +
      `${mean(g.map((i) => i.dBump)).toFixed(2).padStart(6)}  ` +
      `${((100 * d) / g.length).toFixed(0)}%`,
  );
}

// ---- by tag ----
console.log(`\nBy puzzle tag:`);
console.log(`  tag                      n    Δholes  Δmax   Δagg   Δbump  BT-dom  our-dom`);
const allTags = [...new Set(inst.flatMap((i) => i.tags))].sort();
for (const t of allTags) {
  const g = inst.filter((i) => i.tags.includes(t));
  if (!g.length) continue;
  const d = g.filter((i) => i.btDom).length;
  const o = g.filter((i) => i.ourDom).length;
  console.log(
    `  ${t.padEnd(24)} ${String(g.length).padEnd(4)} ` +
      `${mean(g.map((i) => i.dHoles)).toFixed(2).padStart(6)} ` +
      `${mean(g.map((i) => i.dMax)).toFixed(2).padStart(6)} ` +
      `${mean(g.map((i) => i.dAgg)).toFixed(2).padStart(6)} ` +
      `${mean(g.map((i) => i.dBump)).toFixed(2).padStart(6)}  ` +
      `${((100 * d) / g.length).toFixed(0)}%`.padStart(6) +
      `  ${((100 * o) / g.length).toFixed(0)}%`.padStart(6),
  );
}
