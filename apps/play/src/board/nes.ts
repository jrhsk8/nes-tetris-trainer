/**
 * NES Tetris level-18 block sprites (#18).
 *
 * Pixel-accurate replica of how the playfield blocks look on the original NES
 * at level 18. Everything here is derived from the Tetris (NES) disassembly
 * (CelestialAmber/TetrisNESDisasm) rather than eyeballed:
 *
 *  - **Palette.** NES Tetris cycles the playfield palette by `level % 10`.
 *    Level 18 → index 8, whose `colorTable` entry is `$0F,$30,$16,$12`
 *    (black, white, and the two level-18 hues). RGB use the canonical,
 *    recognizable NES values.
 *  - **Block shading.** Each block is an 8×8 tile. There are three tiles —
 *    `$7B`, `$7C`, `$7D` — whose pixel maps are lifted straight from the game
 *    tileset. Colored blocks are a solid fill with a white top-left shine;
 *    the white block is the inverted style (white fill, colored frame). The
 *    bottom row and right column are background, which gives the 1px grid gap
 *    between cells.
 *  - **Piece → colour.** From the disassembly `orientationTable`: T/O/I draw
 *    with `$7B` (white group), Z/L with `$7C`, J/S with `$7D`.
 *
 * Rendered as crisp (`shape-rendering: crispEdges`) vector rects in an SVG data
 * URI, so the blocks scale to any size with no anti-aliasing/blur.
 */

import type { Piece } from '@trainer/core';

/** NES colour group: 1 = white (T, O, I); 2 = Z, L; 3 = J, S. */
export type ColorGroup = 1 | 2 | 3;

/** Which colour group each tetromino draws with on the NES. */
export const PIECE_GROUP: Record<Piece, ColorGroup> = {
  T: 1,
  O: 1,
  I: 1,
  Z: 2,
  L: 2,
  J: 3,
  S: 3,
};

/**
 * Level-18 playfield palette, indexed by the in-tile colour index:
 * `[background, white, colour-2 ($16), colour-3 ($12)]`.
 */
export const LEVEL18_PALETTE = ['#000000', '#fcfcfc', '#d82800', '#0058f8'] as const;

/**
 * The three 8×8 block tiles, as colour-index maps (`0` background, `1` white,
 * `2`/`3` the palette hues). Transcribed pixel-for-pixel from the NES tileset
 * tiles `$7B`/`$7C`/`$7D`.
 */
const TILE_MAPS: Record<ColorGroup, readonly string[]> = {
  // $7B — white group (T, O, I): white fill, colour-3 frame.
  1: [
    '13333330',
    '31111130',
    '31111130',
    '31111130',
    '31111130',
    '31111130',
    '33333330',
    '00000000',
  ],
  // $7C — Z, L: solid colour-2 fill with a white top-left shine.
  2: [
    '12222220',
    '21122220',
    '21222220',
    '22222220',
    '22222220',
    '22222220',
    '22222220',
    '00000000',
  ],
  // $7D — J, S: solid colour-3 fill with a white top-left shine.
  3: [
    '13333330',
    '31133330',
    '31333330',
    '33333330',
    '33333330',
    '33333330',
    '33333330',
    '00000000',
  ],
};

/** Build the inner `<rect>`s for one tile, run-length encoded per row. */
function tileRects(group: ColorGroup, palette: readonly string[]): string {
  const map = TILE_MAPS[group];
  let rects = '';
  for (let y = 0; y < 8; y++) {
    const row = map[y];
    let x = 0;
    while (x < 8) {
      const idx = Number(row[x]);
      if (idx === 0) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < 8 && Number(row[x + run]) === idx) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${palette[idx]}"/>`;
      x += run;
    }
  }
  return rects;
}

const CACHE = new Map<ColorGroup, string>();

/**
 * A CSS `background-image` value (`url("data:image/svg+xml,…")`) for the NES
 * block of `group` at level 18. Memoized — the sprite is constant per group.
 */
export function blockBackground(group: ColorGroup): string {
  const cached = CACHE.get(group);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" ` +
    `shape-rendering="crispEdges">${tileRects(group, LEVEL18_PALETTE)}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  CACHE.set(group, url);
  return url;
}

/** The block background for a piece (via its colour group). */
export function pieceBackground(piece: Piece): string {
  return blockBackground(PIECE_GROUP[piece]);
}
