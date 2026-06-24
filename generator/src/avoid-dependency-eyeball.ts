/**
 * THROWAWAY PROTOTYPE (grill 2026-06-23, "avoid-dependency" tag) — NOT WIRED IN.
 * Safe to delete. De-risks the single-piece-pocket metric before it becomes a
 * real PuzzleTag: reads the live bank, flags puzzles where the rank-1 line is
 * clean (0 single-piece pockets) but a tempting top-K alternative creates >=1,
 * and prints them as ASCII boards so a human can eyeball whether they are real
 * dependency traps. No StackRabbit, no writes — pure analysis of stored combos.
 *
 * Definition under test (v1, "absolute on the resulting board"):
 *   single-piece pocket = a surface notch whose deepest empty cell can be filled
 *   by a HARD DROP of exactly ONE of the 7 piece types without creating a new
 *   hole and without clearing a line. (Open question the eyeball settles:
 *   absolute-on-result vs only-new-vs-start. This is the absolute variant.)
 *
 * Run (read-only; anon key suffices):
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx generator/src/avoid-dependency-eyeball.ts [showN]
 *   (service key also accepted; showN = how many qualifying puzzles to print, default 20)
 */

import {
  COLS,
  ROWS,
  PIECES,
  ORIENTATIONS,
  decodeBoard,
  restingCells,
  applyPlacement,
  columnHeights,
  holes,
  type Grid,
  type Piece,
} from '@trainer/core';
import type { ComboTable } from '@trainer/data';
import { createSupabaseClient } from '@trainer/data';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Load KEY=VALUE lines from the repo-root .env (gitignored) into process.env. */
function loadDotenv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const path of [resolve(here, '../../.env'), resolve(here, '../.env')]) {
    try {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m || m[1].startsWith('#')) continue;
        if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    } catch {
      /* no .env at this path — fine */
    }
  }
}

interface BankRow {
  id: string;
  number: number | null;
  board: string;
  piece1: string;
  piece2: string;
  combos: ComboTable | null;
}

/** One single-piece pocket found on a board: which column's notch, which piece it demands. */
interface Pocket {
  col: number;
  depth: number;
  piece: Piece;
}

function countFilled(grid: Grid): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) n++;
  return n;
}

/**
 * Find every single-piece dependency on a board. A "notch" is a contiguous run
 * of columns below their bounding shoulders. A notch is a dependency for piece P
 * iff P can hard-drop to fill the notch's deepest cell with NO new hole and no
 * line clear, and P is the ONLY piece that can — under one rule from the domain:
 * the long bar (I) is RESERVED for tetrises, so it never counts as a filler for
 * another piece's dependency. I only wins its own shape: a 1-wide vertical well
 * (depth >= 3). For every other notch the candidate set is S/Z/J/L/T/O, and a
 * dependency is a notch exactly one of them resolves cleanly. This matches the
 * domain definition: a J-shaped notch is not "cleanly filled" by an I (the I
 * leaves a hole beside it), so only J counts.
 */
function singlePiecePockets(grid: Grid): Pocket[] {
  const heights = columnHeights(grid);
  const H = (c: number): number => (c < 0 || c >= COLS ? ROWS + 1 : heights[c]);
  const holesBefore = holes(grid);
  const filledBefore = countFilled(grid);

  const notchDepth = new Array<number>(COLS);
  for (let c = 0; c < COLS; c++) notchDepth[c] = Math.min(H(c - 1), H(c + 1)) - heights[c];

  // Can `piece` hard-drop to cover (targetRow, deepCol) with no new hole/clear?
  const canFillCleanly = (piece: Piece, deepCol: number, targetRow: number): boolean => {
    const orientations = ORIENTATIONS[piece];
    for (let rot = 0; rot < orientations.length; rot++) {
      for (let col = deepCol - 3; col <= deepCol + 1; col++) {
        if (col < 0) continue;
        const cells = restingCells(grid, piece, { rotation: rot, col });
        if (!cells) continue;
        if (!cells.some(([r, cc]) => r === targetRow && cc === deepCol)) continue;
        const after = applyPlacement(grid, piece, { rotation: rot, col });
        if (countFilled(after) !== filledBefore + 4) continue; // a line cleared
        if (holes(after) !== holesBefore) continue; // created a new hole
        return true;
      }
    }
    return false;
  };

  const pockets: Pocket[] = [];
  let c = 0;
  while (c < COLS) {
    if (notchDepth[c] < 1) {
      c++;
      continue;
    }
    let end = c;
    while (end + 1 < COLS && notchDepth[end + 1] >= 1) end++;
    const width = end - c + 1;
    let deepCol = c;
    for (let k = c; k <= end; k++) if (heights[k] < heights[deepCol]) deepCol = k;
    const depth = notchDepth[deepCol];
    const targetRow = ROWS - heights[deepCol] - 1;
    c = end + 1;
    if (targetRow < 0) continue;

    // Pure vertical well -> the I-dependency (the only place I counts).
    if (width === 1 && depth >= 3) {
      if (canFillCleanly('I', deepCol, targetRow)) pockets.push({ col: deepCol, depth, piece: 'I' });
      continue;
    }

    // Otherwise: the dependency is a notch exactly one of S/Z/J/L resolves. I is
    // reserved (tetris); O and T are versatile fillers with no dependency of
    // their own (domain) — counting them as fillers would mask real S/Z/J/L
    // dependencies (e.g. a T pokes into an S staircase without a hole).
    const hits = (['S', 'Z', 'J', 'L'] as Piece[]).filter((p) =>
      canFillCleanly(p, deepCol, targetRow),
    );
    if (hits.length === 1) pockets.push({ col: deepCol, depth, piece: hits[0] });
  }
  return pockets;
}

/** Crop trailing empty top rows and render a board as ASCII with a column ruler. */
function render(grid: Grid, markCols: number[] = []): string {
  const heights = columnHeights(grid);
  const top = Math.max(0, ROWS - Math.max(1, ...heights) - 1);
  const lines: string[] = [];
  lines.push('   ' + Array.from({ length: COLS }, (_, i) => i).join(''));
  for (let r = top; r < ROWS; r++) {
    let row = '';
    for (let c = 0; c < COLS; c++) row += grid[r][c] ? '#' : '.';
    lines.push('   ' + row);
  }
  if (markCols.length) {
    let caret = '';
    for (let c = 0; c < COLS; c++) caret += markCols.includes(c) ? '^' : ' ';
    lines.push('   ' + caret);
  }
  return lines.join('\n');
}

/** Build a Grid from a list of bottom-anchored ASCII rows ('.'/'#'), top-padded. */
function fromRows(asciiBottom: string[]): Grid {
  const grid = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
  const start = ROWS - asciiBottom.length;
  asciiBottom.forEach((line, i) => {
    for (let c = 0; c < COLS; c++) grid[start + i][c] = line[c] === '#' ? 1 : 0;
  });
  return grid;
}

/** No-creds sanity check of the pocket detector on hand-built boards. */
function selfTest(): void {
  const cases: Array<{ name: string; rows: string[]; expect: string }> = [
    {
      // Well between two tall walls, rest of the rows EMPTY so the I-fill clears
      // nothing -> a true I-dependency (not a tetris).
      name: 'non-clearing 1-wide well -> I-dependency',
      rows: ['.......#.#', '.......#.#', '.......#.#', '.......#.#'],
      expect: 'one pocket, piece I',
    },
    {
      // Perfectly surrounded depth-4 well: filling it CLEARS 4 lines (a tetris),
      // so it is intentionally NOT a dependency.
      name: 'tetris-ready well -> NOT a dependency (fill clears)',
      rows: ['########.#', '########.#', '########.#', '########.#'],
      expect: 'no pockets (it is a tetris, not a trap)',
    },
    {
      name: 'flat board -> no pocket',
      rows: ['##########'],
      expect: 'no pockets',
    },
    {
      name: 'shallow depth-1 notch -> not single (many pieces fit)',
      rows: ['....#.....', '##########'],
      expect: 'no single-piece pocket',
    },
  ];
  console.log('=== self-test (no DB) ===');
  for (const tc of cases) {
    const grid = fromRows(tc.rows);
    const pockets = singlePiecePockets(grid);
    console.log(`\n${tc.name}  (expect: ${tc.expect})`);
    console.log(render(grid, pockets.map((p) => p.col)));
    console.log(`  -> ${pockets.length === 0 ? 'no pockets' : pockets.map((p) => `col ${p.col}=${p.piece}(d${p.depth})`).join(', ')}`);
  }
}

function emptyBoardLocal(): Grid {
  return Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
}

/**
 * Build the exact mold a piece+rotation drops into: place the piece, fill solid
 * support beneath it and tall side walls, but keep the access channel ABOVE each
 * piece cell open so the piece can hard-drop in. The piece's own cells are left
 * empty — that empty footprint IS the dependency notch. Returns null if the
 * piece can't sit (it never does here) or the mold needs more board than exists.
 */
function buildMold(piece: Piece, rotation: number): Grid | null {
  const cells = restingCells(emptyBoardLocal(), piece, { rotation, col: 3 });
  if (!cells) return null;
  const P = new Set(cells.map(([r, c]) => r * COLS + c));
  const colTop = new Map<number, number>();
  for (const [r, c] of cells) colTop.set(c, Math.min(colTop.get(c) ?? ROWS, r));
  const cols = cells.map(([, c]) => c);
  const minC = Math.min(...cols);
  const maxC = Math.max(...cols);
  const minR = Math.min(...cells.map(([r]) => r));

  const grid = emptyBoardLocal();
  for (let c = minC - 1; c <= maxC + 1; c++) {
    if (c < 0 || c >= COLS) continue;
    for (let r = minR; r < ROWS; r++) {
      if (P.has(r * COLS + c)) continue; // piece cell -> stays empty (the notch)
      const top = colTop.get(c);
      if (top !== undefined && r < top) continue; // access channel above the piece -> open
      grid[r][c] = 1; // wall / support
    }
  }
  return grid;
}

/** Gallery: the confirmed dependency shapes (user-validated) -> detector verdict. */
function pieceProbe(): void {
  // O and T have no real single-piece dependency (per domain) -> omitted.
  const gallery: Array<{ name: string; want: Piece; rows: string[] }> = [
    { name: 'I-dependency (well)', want: 'I', rows: ['...#.#....', '...#.#....', '...#.#....', '...#.#....'] },
    { name: 'J-dependency', want: 'J', rows: ['..#..#....', '..#.##....', '..#.##....'] },
    { name: 'L-dependency', want: 'L', rows: ['..#..#....', '..##.#....', '..##.#....'] },
    { name: 'S-dependency (staircase down-right)', want: 'S', rows: ['..#..#....', '..#..#....', '..##.#....'] },
    { name: 'Z-dependency (staircase down-left)', want: 'Z', rows: ['..#..#....', '..#..#....', '..#.##....'] },
  ];
  console.log('=== dependency gallery (confirmed shapes -> detector verdict) ===');
  for (const g of gallery) {
    const grid = fromRows(g.rows);
    const pockets = singlePiecePockets(grid);
    const got = pockets.map((p) => p.piece);
    const ok = got.length === 1 && got[0] === g.want;
    const verdict = pockets.length === 0 ? 'NONE' : pockets.map((p) => `${p.piece}-dep col${p.col} d${p.depth}`).join(', ');
    console.log(`\n${g.name}  (want ${g.want})  -> ${verdict}  ${ok ? 'OK' : 'MISS'}`);
    console.log(render(grid, pockets.map((p) => p.col)));
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === 'selftest') {
    selfTest();
    return;
  }
  if (process.argv[2] === 'probe') {
    pieceProbe();
    return;
  }
  const showN = Number(process.argv[2] ?? 20);
  loadDotenv();
  // Node 20 has no native WebSocket; Supabase's realtime client trips on it at
  // construction even though we only ever do REST reads. Polyfill from `ws`.
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
    const ws = await import('ws');
    (globalThis as { WebSocket?: unknown }).WebSocket = ws.default;
  }
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL + a key (anon/service) required');

  const client = createSupabaseClient(url, key);
  const { data, error } = await client.from('puzzles').select('id, number, board, piece1, piece2, combos');
  if (error) throw new Error(`read puzzles failed: ${error.message}`);
  const rows = (data ?? []) as BankRow[];

  // Trap knobs (env-tunable): the dirty alt must be TEMPTING (high score) but
  // graded WRONG (< 97), among the top few ranks, and the pocket non-trivial.
  const MIN_SCORE = Number(process.env.MIN_SCORE ?? 90);
  const MAX_SCORE = Number(process.env.MAX_SCORE ?? 96.999); // < CORRECT_SCORE_THRESHOLD
  const MAX_RANK = Number(process.env.MAX_RANK ?? 3); // rank-2 / rank-3 only
  const MIN_DEPTH = Number(process.env.MIN_DEPTH ?? 1); // 1 keeps S/Z staircases
  const NO_EDGE = process.env.NO_EDGE !== '0'; // drop depth-1 notches at col 0/9 (noise)
  const keepPocket = (p: Pocket): boolean =>
    p.depth >= MIN_DEPTH && !(NO_EDGE && p.depth === 1 && (p.col === 0 || p.col === COLS - 1));

  let analyzable = 0;
  let skippedNoKeys = 0;
  const pieceTally: Record<string, number> = {};
  const qualified: Array<{
    row: BankRow;
    altIndex: number;
    altScore: number;
    altPockets: Pocket[];
  }> = [];

  for (const row of rows) {
    const entries = row.combos?.entries ?? [];
    if (entries.length < 2 || !entries[0].boardKey) {
      skippedNoKeys++;
      continue;
    }
    analyzable++;
    const rank1Board = decodeBoard(entries[0].boardKey);
    if (singlePiecePockets(rank1Board).length !== 0) continue; // rank-1 must be clean

    // Highest-scoring tempting alt (within rank/score band) that creates a pocket.
    for (let i = 1; i < entries.length && i < MAX_RANK; i++) {
      const e = entries[i];
      if (!e.boardKey) continue;
      if (e.score < MIN_SCORE || e.score > MAX_SCORE) continue; // tempting but graded wrong
      const pockets = singlePiecePockets(decodeBoard(e.boardKey)).filter(keepPocket);
      if (pockets.length > 0) {
        qualified.push({ row, altIndex: i, altScore: e.score, altPockets: pockets });
        for (const p of pockets) pieceTally[p.piece] = (pieceTally[p.piece] ?? 0) + 1;
        break;
      }
    }
  }

  console.log(`\n=== avoid-dependency eyeball (v2: tempting trap) ===`);
  console.log(`knobs: score [${MIN_SCORE}, ${MAX_SCORE}], rank < ${MAX_RANK}, pocket depth >= ${MIN_DEPTH}`);
  console.log(`bank rows:          ${rows.length}`);
  console.log(`analyzable (>=2 keyed combos): ${analyzable}`);
  console.log(`skipped (legacy/no keys):      ${skippedNoKeys}`);
  console.log(`QUALIFIED (clean rank-1 + tempting dirty alt): ${qualified.length}`);
  const pct = analyzable ? ((qualified.length / analyzable) * 100).toFixed(1) : '0';
  console.log(`  = ${pct}% of analyzable puzzles`);
  console.log(`pocket-piece tally: ${JSON.stringify(pieceTally)}`);

  const sample = qualified.slice(0, showN);
  console.log(`\n--- first ${sample.length} qualifying puzzles ---`);
  for (const q of sample) {
    const { row, altIndex, altScore, altPockets } = q;
    const entries = row.combos!.entries;
    const start = decodeBoard(row.board);
    const best = decodeBoard(entries[0].boardKey!);
    const alt = decodeBoard(entries[altIndex].boardKey!);
    const markCols = altPockets.map((p) => p.col);
    const pocketDesc = altPockets
      .map((p) => `col ${p.col} needs ${p.piece} (depth ${p.depth})`)
      .join('; ');

    console.log(`\n#${row.number ?? '?'} (${row.id.slice(0, 8)})  pieces ${row.piece1}->${row.piece2}`);
    console.log(`  trap: rank-${altIndex + 1} alt scores ${altScore.toFixed(1)} and creates -> ${pocketDesc}`);
    console.log(`  START:`);
    console.log(render(start));
    console.log(`  CLEAN BEST (rank-1, score 100, 0 pockets):`);
    console.log(render(best));
    console.log(`  TEMPTING DIRTY ALT (rank-${altIndex + 1}, score ${altScore.toFixed(1)}):`);
    console.log(render(alt, markCols));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
