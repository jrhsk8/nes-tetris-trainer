/**
 * Read-only live-bank **duplicate / near-duplicate audit**.
 *
 * The generation pipeline rejects a candidate whose `(piece1, piece2)` match AND
 * whose board is within `dedupMaxHamming` (=4) cells of an already-accepted puzzle
 * ({@link isNearDuplicate}). But puzzles inserted across separate runs, or by
 * different generators, are only deduped against the bank as it stood at the time
 * — so collisions can still accumulate. This audit sweeps the WHOLE bank after the
 * fact and reports:
 *
 *  1. **Exact-board** clusters — two+ puzzles sharing the identical 200-char board
 *     (the strongest signal of a true duplicate), split by whether the piece pair
 *     also matches.
 *  2. **Near-board** clusters — boards within a small Hamming distance, both for
 *     the SAME piece pair (the production dedup criterion, retroactively) and for
 *     ANY pieces (near-identical look-alikes regardless of pieces).
 *
 * Strictly read-only — it never mutates the bank; it prints what it finds so a
 * human decides what (if anything) to cull. Creds from repo-root .env (never
 * printed). Offline / generator-only.
 *
 *   npx tsx generator/src/bank-dedup-audit.ts [--max-hamming N] [--all]
 *
 * `--max-hamming N` sets the near-duplicate threshold (default 6).
 * `--all` audits every row; default audits ACTIVE puzzles only.
 */
// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
Object.assign(globalThis, { WebSocket: globalThis.WebSocket ?? ws });

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBoard, type Grid, type Piece } from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';
import { boardHamming } from './pipeline/dedup.js';

const args = process.argv.slice(2);
const maxHamming = Number(args[args.indexOf('--max-hamming') + 1]) || 6;
const includeInactive = args.includes('--all');

// Load repo-root .env into process.env (no printing).
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!process.env[k]) process.env[k] = v;
}
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
const client = createSupabaseClient(url, key);

interface Row {
  number: number | null;
  board: string; // 200-char encoding
  piece1: Piece;
  piece2: Piece;
  active: boolean;
  created_at: string;
  grid: Grid;
}

/** A connected cluster of puzzles whose boards are mutually near (transitive). */
interface Cluster {
  rows: Row[];
  samePieces: boolean; // every member shares the same (piece1, piece2)
  maxDist: number; // the largest pairwise Hamming inside the cluster
}

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = client
      .from('puzzles')
      .select('number, board, piece1, piece2, active, created_at')
      .order('number', { ascending: true })
      .range(from, from + 999);
    if (!includeInactive) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of data ?? [])
      rows.push({ ...(r as any), active: (r as any).active !== false, grid: decodeBoard((r as any).board) });
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const label = (r: Row): string =>
  `#${r.number ?? '?'} ${r.piece1}+${r.piece2}${r.active ? '' : ' (inactive)'} ${r.created_at?.slice(0, 10) ?? ''}`;

/** Union-find clustering of rows whose pairwise Hamming ≤ threshold. */
function clusterByHamming(rows: Row[], threshold: number): Cluster[] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  // O(n²) pairwise — fine for a few thousand rows.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (boardHamming(rows[i].grid, rows[j].grid) <= threshold) union(i, j);
    }
  }
  const groups = new Map<number, Row[]>();
  for (let i = 0; i < rows.length; i++) {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(rows[i]);
  }
  const clusters: Cluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let maxDist = 0;
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++)
        maxDist = Math.max(maxDist, boardHamming(members[i].grid, members[j].grid));
    const samePieces = members.every((m) => m.piece1 === members[0].piece1 && m.piece2 === members[0].piece2);
    clusters.push({ rows: members, samePieces, maxDist });
  }
  // Largest / most-similar first.
  return clusters.sort((a, b) => b.rows.length - a.rows.length || a.maxDist - b.maxDist);
}

function printClusters(title: string, clusters: Cluster[]): void {
  const totalRows = clusters.reduce((n, c) => n + c.rows.length, 0);
  const removable = clusters.reduce((n, c) => n + (c.rows.length - 1), 0); // keep 1 per cluster
  console.log(`\n=== ${title} ===`);
  console.log(`clusters: ${clusters.length} | puzzles involved: ${totalRows} | redundant (cluster size − 1): ${removable}`);
  for (const c of clusters) {
    const tag = c.samePieces ? 'same-pieces' : 'MIXED-pieces';
    console.log(`\n  cluster of ${c.rows.length} [${tag}, max Hamming ${c.maxDist}]:`);
    for (const r of c.rows.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) console.log(`    ${label(r)}`);
  }
}

async function main(): Promise<void> {
  const rows = await loadRows();
  console.log(`audited ${rows.length} ${includeInactive ? '(all)' : 'active'} puzzles; near-duplicate threshold = Hamming ≤ ${maxHamming}`);

  // 1. Exact-board duplicates (Hamming 0), grouped by board string.
  const byBoard = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byBoard.has(r.board)) byBoard.set(r.board, []);
    byBoard.get(r.board)!.push(r);
  }
  const exact: Cluster[] = [];
  for (const members of byBoard.values()) {
    if (members.length < 2) continue;
    exact.push({
      rows: members,
      samePieces: members.every((m) => m.piece1 === members[0].piece1 && m.piece2 === members[0].piece2),
      maxDist: 0,
    });
  }
  exact.sort((a, b) => b.rows.length - a.rows.length);
  printClusters('EXACT identical starting board (Hamming = 0)', exact);

  // 2. Near-duplicate clusters (Hamming ≤ maxHamming). Includes the exact ones,
  //    so subtract those when reasoning about NEW near-dupes.
  const near = clusterByHamming(rows, maxHamming);
  const nearSamePieces = near.filter((c) => c.samePieces);
  printClusters(
    `NEAR-identical, SAME piece pair (Hamming ≤ ${maxHamming}) — the production dedup criterion, retroactive`,
    nearSamePieces,
  );
  const nearMixed = near.filter((c) => !c.samePieces);
  printClusters(
    `NEAR-identical, ANY pieces (Hamming ≤ ${maxHamming}) — look-alike boards regardless of pieces`,
    nearMixed,
  );

  // Summary.
  const exactRedundant = exact.reduce((n, c) => n + (c.rows.length - 1), 0);
  const sameRedundant = nearSamePieces.reduce((n, c) => n + (c.rows.length - 1), 0);
  console.log(`\n──────── SUMMARY ────────`);
  console.log(`exact-board duplicates: ${exact.length} clusters, ${exactRedundant} redundant puzzles`);
  console.log(`near-dupe (same pieces, ≤${maxHamming}): ${nearSamePieces.length} clusters, ${sameRedundant} redundant`);
  console.log(`near-dupe (any pieces, ≤${maxHamming}): ${nearMixed.length} clusters`);
  console.log(`(read-only — nothing was modified)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
