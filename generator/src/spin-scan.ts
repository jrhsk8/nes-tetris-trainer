/**
 * Diagnostic: scan the live bank for stored combo entries that involve a spin
 * placement (any rank, not just rank-1). Reports per-puzzle spin combos with
 * their score and which piece is spun. Answers: "do spin combos exist in the
 * bank at all, or does the engine never value them?"
 *
 * Run:
 *   NODE_OPTIONS="--experimental-websocket" npx tsx generator/src/spin-scan.ts
 *
 * Env: SUPABASE_URL + service key (or anon key — read-only).
 */

import { pathToFileURL } from 'node:url';
import {
  decodeBoard,
  isPiece,
  maneuver,
  type Piece,
} from '@trainer/core';
import { restingLineForEntry, lockAndClear } from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';
import type { ComboTable } from '@trainer/data';

interface BankRow {
  id: string;
  number: number | null;
  board: string;
  piece1: string;
  piece2: string;
  combos: ComboTable | null;
}

interface SpinHit {
  puzzleId: string;
  puzzleNumber: number | null;
  rank: number;
  score: number;
  piece: Piece;
  maneuverType: 'spin' | 'tuck';
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) throw new Error('SUPABASE_URL + key required');

  const client = createSupabaseClient(supabaseUrl, key);
  const PAGE = 1000;
  const rows: BankRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('puzzles')
      .select('id, number, board, piece1, piece2, combos')
      .eq('active', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read puzzles failed: ${error.message}`);
    const batch = (data ?? []) as BankRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  console.log(`scanning ${rows.length} active puzzles for spin/tuck combos…\n`);

  const hits: SpinHit[] = [];
  let scanned = 0;

  for (const row of rows) {
    if (!isPiece(row.piece1) || !isPiece(row.piece2)) continue;
    const entries = row.combos?.entries ?? [];
    if (entries.length === 0) continue;
    const grid = decodeBoard(row.board);
    const p1 = row.piece1 as Piece;
    const p2 = row.piece2 as Piece;
    scanned++;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const line = restingLineForEntry(grid, p1, p2, entry);
      if (!line) continue;

      const a = lockAndClear(grid, p1, line.p1);
      const m1 = maneuver(grid, p1, line.p1);
      const m2 = maneuver(a.board, p2, line.p2);

      if (m1 === 'spin' || m1 === 'tuck') {
        hits.push({
          puzzleId: row.id,
          puzzleNumber: row.number,
          rank: i + 1,
          score: entry.score,
          piece: p1,
          maneuverType: m1,
        });
      }
      if (m2 === 'spin' || m2 === 'tuck') {
        hits.push({
          puzzleId: row.id,
          puzzleNumber: row.number,
          rank: i + 1,
          score: entry.score,
          piece: p2,
          maneuverType: m2,
        });
      }
    }
  }

  // Summarize
  const spins = hits.filter((h) => h.maneuverType === 'spin');
  const tucks = hits.filter((h) => h.maneuverType === 'tuck');
  const tSpins = spins.filter((h) => h.piece === 'T');

  console.log(`scanned: ${scanned} puzzles`);
  console.log(`total spin placements across all stored combos: ${spins.length}`);
  console.log(`  T-spins: ${tSpins.length}`);
  console.log(`total tuck placements across all stored combos: ${tucks.length}`);

  // Show top spin hits by score
  const spinsByScore = spins.sort((a, b) => b.score - a.score);
  console.log(`\ntop spin combos (any rank):`);
  for (const h of spinsByScore.slice(0, 30)) {
    console.log(
      `  #${h.puzzleNumber ?? '?'} (${h.puzzleId.slice(0, 8)}) ` +
        `rank=${h.rank} score=${h.score.toFixed(1)} piece=${h.piece}`,
    );
  }

  // Score distribution
  const correct = spins.filter((h) => h.score >= 97);
  const near = spins.filter((h) => h.score >= 90 && h.score < 97);
  const low = spins.filter((h) => h.score < 90);
  console.log(`\nspin score distribution:`);
  console.log(`  correct (≥97): ${correct.length}`);
  console.log(`  near (90–96): ${near.length}`);
  console.log(`  low (<90): ${low.length}`);

  // Rank distribution
  const rank1 = spins.filter((h) => h.rank === 1);
  const rank2to5 = spins.filter((h) => h.rank >= 2 && h.rank <= 5);
  console.log(`\nspin rank distribution:`);
  console.log(`  rank-1: ${rank1.length}`);
  console.log(`  rank 2–5: ${rank2to5.length}`);
  console.log(`  rank 6+: ${spins.length - rank1.length - rank2to5.length}`);

  // Same for tucks
  const tucksByScore = tucks.sort((a, b) => b.score - a.score);
  console.log(`\ntop tuck combos (any rank):`);
  for (const h of tucksByScore.slice(0, 20)) {
    console.log(
      `  #${h.puzzleNumber ?? '?'} (${h.puzzleId.slice(0, 8)}) ` +
        `rank=${h.rank} score=${h.score.toFixed(1)} piece=${h.piece}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
