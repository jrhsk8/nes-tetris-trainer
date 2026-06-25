/**
 * For the tuck/spin/t-spin bank puzzles: which PIECE carries the special
 * maneuver, and does BetaTetris agree on it? Reconstructs each puzzle's resting
 * line from its rank-1 combo (the same `restingLineForEntry` + `maneuver` path
 * the generator tags with) and joins it with the BetaTetris consensus verdict
 * (engines/betatetris/special_verdict.json) so we can tell:
 *
 *  - when the tuck/spin is PIECE 1, does BT rank that exact move #1 (verdict keep
 *    or disagree-p2 = piece-1 agreed)? → proof tuck/spin agreement is achievable.
 *  - when BT disagrees on piece 1, is the special move even on piece 1, or is it
 *    on piece 2 (so piece-1 disagreement is about a plain placement)?
 *
 * Read-only; loads creds from repo-root .env (never printed). Offline-only.
 *   npx tsx generator/src/special-maneuver.ts
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBoard, lockAndClear, maneuver, restingLineForEntry, type Piece } from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  if (!process.env[t.slice(0, i).trim()])
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const client = createSupabaseClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
);

const BT = join(root, 'engines', 'betatetris');
const verdicts: any[] = JSON.parse(readFileSync(join(BT, 'special_verdict.json'), 'utf8'));
const verdictBy = new Map(verdicts.map((v) => [v.number, v]));

const rows: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await client
    .from('puzzles')
    .select('number, board, piece1, piece2, combos, tags')
    .order('number', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const SP = ['tuck', 'spin', 't-spin', 'spintuck'];
const special = rows.filter((r) => (r.tags ?? []).some((t: string) => SP.includes(t)));

const rowsOut: any[] = [];
for (const r of special) {
  const board0 = decodeBoard(r.board);
  const entry = (r.combos as any)?.entries?.[0];
  let m1 = 'no-recon';
  let m2 = 'no-recon';
  if (entry) {
    const line = restingLineForEntry(board0, r.piece1 as Piece, r.piece2 as Piece, entry);
    if (line) {
      m1 = maneuver(board0, r.piece1 as Piece, line.p1);
      const a = lockAndClear(board0, r.piece1 as Piece, line.p1);
      m2 = maneuver(a.board, r.piece2 as Piece, line.p2);
    }
  }
  const s1 = m1 === 'tuck' || m1 === 'spin';
  const s2 = m2 === 'tuck' || m2 === 'spin';
  rowsOut.push({
    number: r.number,
    tags: r.tags,
    m1,
    m2,
    specialPiece: s1 && s2 ? 'both' : s1 ? 'p1' : s2 ? 'p2' : 'none',
    reason: verdictBy.get(r.number)?.reason ?? 'no-verdict',
    rank: verdictBy.get(r.number)?.rank,
  });
}

// ---- report ----
const norm = (r: any) => (r.reason === null ? 'keep' : r.reason);
const pieceReason: Record<string, Record<string, number>> = { p1: {}, p2: {}, both: {}, none: {} };
for (const r of rowsOut) {
  const sp = r.specialPiece;
  const reason = norm(r);
  pieceReason[sp][reason] = (pieceReason[sp][reason] ?? 0) + 1;
}
const p1c = rowsOut.filter((r) => r.specialPiece === 'p1' || r.specialPiece === 'both').length;
const p2c = rowsOut.filter((r) => r.specialPiece === 'p2' || r.specialPiece === 'both').length;
console.log(`special puzzles: ${special.length}`);
console.log(`special maneuver on: piece1=${p1c}  piece2=${p2c}  (both counted in each)\n`);
console.log(`verdict by which-piece-carries-the-special-move:`);
for (const sp of ['p1', 'p2', 'both', 'none']) {
  const tot = Object.values(pieceReason[sp]).reduce((a, b) => a + b, 0);
  if (!tot) continue;
  console.log(`  special on ${sp.padEnd(4)} (n=${tot}): ${JSON.stringify(pieceReason[sp])}`);
}

// DECISIVE: special move on piece-1 AND BT ranked that exact move #1
const p1Agreed = rowsOut.filter(
  (r) => (r.specialPiece === 'p1' || r.specialPiece === 'both') &&
    (norm(r) === 'keep' || norm(r) === 'disagree-p2'),
);
console.log(`\nDECISIVE — tuck/spin IS piece-1 AND BetaTetris ranks that exact move #1: ${p1Agreed.length}`);
for (const r of p1Agreed) {
  const sp = (r.tags ?? []).filter((t: string) => SP.includes(t)).join(',');
  console.log(`  #${r.number} m1=${r.m1} [${sp}] verdict=${norm(r)}`);
}

// piece-1 disagreements: is the special move actually on piece 1?
const d1 = rowsOut.filter((r) => norm(r) === 'disagree');
const d1SpecialP1 = d1.filter((r) => r.specialPiece === 'p1' || r.specialPiece === 'both').length;
console.log(`\npiece-1 disagreements (n=${d1.length}): special-move-on-piece1=${d1SpecialP1}, special-move-on-piece2-only=${d1.length - d1SpecialP1}`);
