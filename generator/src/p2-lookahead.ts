/**
 * Experiment A (#55 follow-up): the original question — what if StackRabbit
 * evaluated piece 2 *with piece 3 in mind*? Would BetaTetris's piece-2 pick then
 * outrank our stored optimal on StackRabbit?
 *
 * Our optimal is StackRabbit's EVAL-ONLY (`nextPiece=null`) best piece-2
 * placement, so without lookahead it beats BT's pick by construction. Here, for
 * every disagree-p2 instance — same post-piece-1 board (`p1_key`), our optimal
 * vs BT's piece-2 board, under the SPECIFIC p3 BT saw — we re-rate BOTH boards
 * with `nextPiece = p3` (StackRabbit's "after adjustment" value: place piece 2,
 * then its own best p3 response). The flip rate is the fraction where BT's board
 * now scores higher than ours once StackRabbit sees p3.
 *
 * Needs the StackRabbit server up (127.0.0.1:3000) and
 * engines/betatetris/p2_disagree_boards.json (from p2_disagree_boards.py).
 * Offline / generator-only.
 *
 *   tsx generator/src/p2-lookahead.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBoard, type Piece } from '@trainer/core';
import { StackRabbitClient } from './engine/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const BT = join(here, '..', '..', 'engines', 'betatetris');

const LEVEL = 18;
const LINES = 0;
const TIMELINE = 'X.....'; // the generation valuation timeline
const P3 = 'TJZOSLI'; // BetaTetris piece-index order (fceux.py)
const CONCURRENCY = 6;

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
const engine = new StackRabbitClient({ baseUrl: 'http://127.0.0.1:3000' });

interface Result {
  number: number;
  p2_agree: number;
  tags: string[];
  p3_id: number;
  ourNoP3: number;
  btNoP3: number | null;
  ourP3: number | null;
  btP3: number | null;
  bestP3: number | null; // SR's p3-aware best from p1_key
  ourReach: boolean;
  btReach: boolean;
}

async function rate(board: string, current: Piece, next: Piece | null, after: string) {
  return engine.rateMove(
    {
      board: decodeBoard(board),
      currentPiece: current,
      nextPiece: next,
      level: LEVEL,
      lines: LINES,
      inputFrameTimeline: TIMELINE,
    },
    decodeBoard(after),
  );
}

async function processPuzzle(pz: PuzzleRec): Promise<Result[]> {
  const out: Result[] = [];
  const piece2 = pz.piece2 as Piece;
  // our value with NO lookahead — shared across this puzzle's p3 values.
  let ourNoP3 = Number.NaN;
  let ourReachNo = true;
  try {
    ourNoP3 = (await rate(pz.p1_key, piece2, null, pz.our_full_key)).playerValue;
  } catch {
    ourReachNo = false;
  }
  for (const e of pz.p3) {
    if (e.agree !== false || !e.bt_board) continue;
    const next = P3[e.p3_id] as Piece;
    let ourP3: number | null = null;
    let btP3: number | null = null;
    let bestP3: number | null = null;
    let btNoP3: number | null = null;
    let ourReach = ourReachNo;
    let btReach = true;
    try {
      const r = await rate(pz.p1_key, piece2, next, pz.our_full_key);
      ourP3 = r.playerValue;
      bestP3 = r.bestValue;
    } catch {
      ourReach = false;
    }
    try {
      const r = await rate(pz.p1_key, piece2, next, e.bt_board);
      btP3 = r.playerValue;
      bestP3 = bestP3 ?? r.bestValue; // same anchor either way
    } catch {
      btReach = false;
    }
    try {
      btNoP3 = (await rate(pz.p1_key, piece2, null, e.bt_board)).playerValue;
    } catch {
      /* leave null */
    }
    out.push({
      number: pz.number,
      p2_agree: pz.p2_agree,
      tags: tagsByNum.get(pz.number) ?? [],
      p3_id: e.p3_id,
      ourNoP3,
      btNoP3,
      ourP3,
      btP3,
      bestP3,
      ourReach,
      btReach,
    });
  }
  return out;
}

// simple concurrency pool over puzzles
async function run() {
  if (!(await engine.ping())) {
    throw new Error('StackRabbit not reachable at 127.0.0.1:3000');
  }
  const results: Result[] = [];
  let idx = 0;
  let done = 0;
  const t0 = Date.now();
  async function worker() {
    while (idx < data.length) {
      const my = idx++;
      const r = await processPuzzle(data[my]);
      results.push(...r);
      done++;
      if (done % 25 === 0 || done === data.length) {
        process.stdout.write(`  ${done}/${data.length} puzzles (${Math.round((Date.now() - t0) / 1000)}s)\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  writeFileSync(join(BT, 'p2_lookahead.json'), JSON.stringify(results));
  report(results);
}

function report(results: Result[]) {
  // both reachable + both p3 values present
  const ok = results.filter((r) => r.btReach && r.ourReach && r.ourP3 !== null && r.btP3 !== null);
  const unreachBt = results.filter((r) => !r.btReach).length;
  const unreachOur = results.filter((r) => !r.ourReach).length;
  const N = ok.length;
  const pct = (k: number) => `${k}/${N} (${((100 * k) / N).toFixed(0)}%)`;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const flipP3 = ok.filter((r) => (r.btP3 as number) > (r.ourP3 as number));
  const flipNoP3 = results.filter(
    (r) => r.btNoP3 !== null && r.btReach && r.btNoP3 > r.ourNoP3,
  );
  const tieP3 = ok.filter((r) => (r.btP3 as number) === (r.ourP3 as number));

  console.log(`\n=== Experiment A: does p3-aware StackRabbit move toward BT's piece-2 pick? ===`);
  console.log(`rated instances: ${N}   (BT unreachable under ${TIMELINE}: ${unreachBt}, ours unreachable: ${unreachOur})`);
  console.log(`\nBaseline — NO p3 lookahead (our optimal is SR eval-only best, so BT should ~never win):`);
  console.log(`  BT outranks ours: ${flipNoP3.length}/${results.length} (${((100 * flipNoP3.length) / results.length).toFixed(1)}%)`);
  console.log(`\nWith p3 lookahead (nextPiece = the p3 BT actually saw):`);
  console.log(`  BT outranks ours (flip):  ${pct(flipP3.length)}`);
  console.log(`  exact tie:                ${pct(tieP3.length)}`);
  console.log(`  ours still ahead:         ${pct(N - flipP3.length - tieP3.length)}`);
  console.log(
    `  mean SR gap (ours − BT): no-p3 ${mean(ok.map((r) => r.ourNoP3 - (r.btNoP3 ?? r.ourNoP3))).toFixed(2)}  →  with-p3 ${mean(ok.map((r) => (r.ourP3 as number) - (r.btP3 as number))).toFixed(2)}`,
  );
  console.log(
    `  (positive gap = ours scores higher; shrinking toward/below 0 = p3 closes it)`,
  );

  console.log(`\nFlip rate by disagreement strength (p2_agree; 0 = BT disagrees on all 7):`);
  for (let a = 0; a <= 6; a++) {
    const g = ok.filter((r) => r.p2_agree === a);
    if (!g.length) continue;
    const f = g.filter((r) => (r.btP3 as number) > (r.ourP3 as number)).length;
    console.log(`  ${a}/7   n=${String(g.length).padEnd(4)} flip ${((100 * f) / g.length).toFixed(0)}%   mean gap(ours−BT) ${mean(g.map((r) => (r.ourP3 as number) - (r.btP3 as number))).toFixed(2)}`);
  }

  console.log(`\nFlip rate by tag:`);
  const allTags = [...new Set(ok.flatMap((r) => r.tags))].sort();
  for (const t of allTags) {
    const g = ok.filter((r) => r.tags.includes(t));
    if (!g.length) continue;
    const f = g.filter((r) => (r.btP3 as number) > (r.ourP3 as number)).length;
    console.log(`  ${t.padEnd(24)} n=${String(g.length).padEnd(4)} flip ${((100 * f) / g.length).toFixed(0).padStart(3)}%   mean gap(ours−BT) ${mean(g.map((r) => (r.ourP3 as number) - (r.btP3 as number))).toFixed(2)}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
