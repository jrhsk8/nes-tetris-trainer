/**
 * Per-piece forced line-clearing SPIN constructor (#94) — generalizes the proven
 * {@link constructTSpinDouble} recipe to every piece whose spin can be forced into
 * a clean line clear.
 *
 * The shape: piece 1 (`O`) hard-drops into a 2×2 gap, and piece 2 must **spin**
 * into a roofed pocket to complete the bottom two rows. The roof (overhang) blocks
 * a straight hard-drop into the pocket and blocks sliding the final orientation in
 * sideways (so the maneuver is a true `spin`, not a `tuck` or hard-drop), exactly
 * as the T-spin double does — only the pocket shape and roof are searched per piece.
 *
 * Yield by piece (measured via {@link inputReachableRestingPlacements}, the #91
 * descending-spin law): **T, J, L** all force a reachable 2-line-clear spin
 * (T rot 2, J rot 2, L rot 2). **S and Z force no reachable line-clearing spin
 * in this family** — their characteristic line maneuver is a tuck, not a spin —
 * so they are out of scope here (see the tuck/spintuck path).
 *
 * Pure construction + core verification (no engine). The bank runner gates each
 * survivor on StackRabbit rank-1 + BetaTetris consensus + dedup before insert.
 *
 *   npx tsx generator/src/forced-spin.ts            # yield report per piece
 */
import {
  emptyBoard,
  pieceCells,
  enumerateResting,
  applyRestingPlacement,
  isResting,
  maneuver,
  boardKey,
  isInputReachable,
  ORIENTATIONS,
  type Grid,
  type Piece,
  type RestingPlacement,
} from '@trainer/core';

const randInt = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(a: readonly T[]): T => a[randInt(a.length)];
export const cellCount = (b: Grid): number =>
  b.reduce((n, r) => n + r.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
export const fullRows = (b: Grid): number => b.filter((r) => r.every((c) => c)).length;

/** The spinnable pieces that force a reachable line-clearing spin in this family. */
export const FORCED_SPIN_PIECES: readonly Piece[] = ['T', 'J', 'L'];

/** A constructed forced-spin board plus the verified spin placement of piece 2. */
export interface ForcedSpin {
  kind: string; // e.g. 't-spin', 'j-spin', 'l-spin'
  board: Grid;
  piece1: Piece; // always 'O'
  piece2: Piece;
  slotCol: number; // the pocket column, for the per-column variety cap
  p1: RestingPlacement; // O into its gap
  p2: RestingPlacement; // the forced spin
  p1_key: string;
  full_key: string;
  clears: number;
  tag: string; // the per-piece spin tag, e.g. 'j-spin'
}

const SPIN_TAG_OF: Partial<Record<Piece, string>> = { T: 't-spin', J: 'j-spin', L: 'l-spin' };

/** The 2-row rotations of `piece` (the ones that can complete a 2-line clear). */
function twoRowRotations(piece: Piece): number[] {
  const out: number[] = [];
  ORIENTATIONS[piece].forEach((cells, rot) => {
    const rows = new Set(cells.map(([r]) => r));
    if (rows.size === 2) out.push(rot);
  });
  return out;
}

/**
 * Construct one forced line-clearing spin of `piece2` (piece 1 is always `O`),
 * or `null` if this random attempt did not yield a reachable spin. Caller loops.
 *
 * Strategy: place `piece2` in a 2-row rotation flush at the bottom, carve its
 * footprint and a 2×2 `O`-gap out of the (otherwise full) bottom two rows, then
 * search small roof structures above the pocket for one that makes the placement
 * a reachable `spin` (per {@link maneuver} + {@link isInputReachable}) clearing
 * exactly the two rows. A varied skyline on the free columns supplies variety and
 * keeps the cell count even.
 */
export function constructForcedSpin(piece2: Piece): ForcedSpin | null {
  const tag = SPIN_TAG_OF[piece2];
  if (!tag) return null;
  const rots = twoRowRotations(piece2);
  if (!rots.length) return null;
  const R = pick(rots);
  const shape = ORIENTATIONS[piece2][R];
  const w = Math.max(...shape.map(([, c]) => c)) + 1;
  const baseRow = 18; // span rows 18..19 (the two rows that clear)
  const baseCol = randInt(10 - w + 1);
  const F = pieceCells(piece2, R, baseRow, baseCol);
  const Fkey = new Set(F.map(([r, c]) => r * 10 + c));
  const Fcols = [...new Set(F.map(([, c]) => c))];
  const minC = Math.min(...Fcols);
  const maxC = Math.max(...Fcols);

  // O-gap {g,g+1}, disjoint from the piece's columns (O drops in to finish the rows).
  const gOpts: number[] = [];
  for (let g = 0; g < 9; g++) if (!Fcols.includes(g) && !Fcols.includes(g + 1)) gOpts.push(g);
  if (!gOpts.length) return null;
  const g = pick(gOpts);
  const gap = new Set([g, g + 1]);

  // Candidate roof cells just above the pocket (rows 16..17, cols around the piece).
  const roofCands: Array<[number, number]> = [];
  for (let c = Math.max(0, minC - 1); c <= Math.min(9, maxC + 1); c++) {
    for (let r = 16; r <= 17; r++) if (!Fkey.has(r * 10 + c)) roofCands.push([r, c]);
  }
  const roofs: Array<Array<[number, number]>> = [];
  for (const a of roofCands) roofs.push([a]);
  for (let i = 0; i < roofCands.length; i++)
    for (let j = i + 1; j < roofCands.length; j++) roofs.push([roofCands[i], roofCands[j]]);

  const open = new Set<number>([...Fcols, g, g + 1]);
  for (const roof of shuffle(roofs)) {
    const board = emptyBoard();
    // Fill rows 18,19 full except the footprint and the O-gap.
    for (const rr of [18, 19]) for (let c = 0; c < 10; c++) if (!Fkey.has(rr * 10 + c) && !gap.has(c)) board[rr][c] = 1;
    const roofCols = new Set(roof.map(([, c]) => c));
    let blocked = false;
    for (const [r, c] of roof) {
      if (board[r][c]) { blocked = true; break; }
      board[r][c] = 1;
    }
    if (blocked) continue;
    // Varied skyline for parity + variety on the untouched columns. Fill DOWN
    // from the surface row (17) so each column stays gap-free above the full
    // bottom rows — a gap here would read as a hole and fail the prefilter.
    for (let c = 0; c < 10; c++) {
      if (open.has(c) || roofCols.has(c)) continue;
      const hh = randInt(4);
      for (let k = 0; k < hh; k++) if (17 - k >= 0) board[17 - k][c] = 1;
    }
    if (cellCount(board) % 2 !== 0) continue; // even-parity sanity (matches coreVerify)
    if (fullRows(board) > 0) continue;

    // Piece 1: O hard-drops (deepest) into its gap column.
    const p1 = enumerateResting(board, 'O').filter((p) => p.col === g).sort((a, b) => b.row - a.row)[0];
    if (!p1) continue;
    const board1 = applyRestingPlacement(board, 'O', p1);

    const p2: RestingPlacement = { rotation: R, row: baseRow, col: baseCol };
    if (!isResting(board1, piece2, p2.rotation, p2.row, p2.col)) continue;
    const after = applyRestingPlacement(board1, piece2, p2);
    const clears = (cellCount(board1) + 4 - cellCount(after)) / 10;
    if (clears < 2) continue;
    if (maneuver(board1, piece2, p2) !== 'spin') continue;
    if (!isInputReachable(board1, piece2, p2)) continue;

    return {
      kind: tag,
      board,
      piece1: 'O',
      piece2,
      slotCol: baseCol + Math.floor(w / 2),
      p1,
      p2,
      p1_key: boardKey(board1),
      full_key: boardKey(after),
      clears,
      tag,
    };
  }
  return null;
}

/** Fisher-Yates-ish shuffle (Math.random; generation is non-deterministic by design). */
function shuffle<T>(a: T[]): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const render = (b: Grid): string =>
  b
    .map((row, r) => (row.some((x) => x) ? `  r${String(r).padStart(2)} ${row.map((x) => (x ? '█' : '·')).join('')}` : null))
    .filter(Boolean)
    .join('\n');

import { pathToFileURL } from 'node:url';
async function main(): Promise<void> {
  const target = Number(process.argv[2] ?? 5);
  for (const piece of FORCED_SPIN_PIECES) {
    let found = 0;
    let tries = 0;
    const samples: ForcedSpin[] = [];
    while (found < target && tries < target * 400) {
      tries++;
      const c = constructForcedSpin(piece);
      if (c) {
        found++;
        if (samples.length < 1) samples.push(c);
      }
    }
    console.log(`${piece}-spin: ${found}/${target} forced reachable line-clearing spins in ${tries} tries`);
    for (const s of samples) {
      console.log(`  rot${s.p2.rotation} slotCol=${s.slotCol} clears=${s.clears} [${s.tag}]`);
      console.log(render(s.board));
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
