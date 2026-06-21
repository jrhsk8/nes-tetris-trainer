/**
 * NES board screenshot OCR (#45, v2 overhaul issue I) — pure raster ⇄ position.
 *
 * The play app uploads a screenshot of a board; the OFFLINE pipeline parses it
 * into a {@link ParsedScreenshot} (board + colours + the two pieces + level) and
 * feeds it to the generator. The engine is never deployed — this runs offline.
 *
 * A real NES playfield is a regular grid of cells in a small known palette, so
 * OCR is geometry + nearest-colour classification, not character recognition.
 * To stay deterministic and to *reject misreads rather than bank them*, the
 * parser assumes a **canonical capture layout** ({@link DEFAULT_LAYOUT}): a
 * 10×20 board, two 4×4 piece-preview boxes (current, next), and a 2-digit level
 * readout in a tiny bitmap font. {@link renderScreenshot} is the inverse — it
 * draws that exact layout — so a render→parse round-trip is lossless and tests
 * have a "known screenshot". Anything off-format (wrong size, noisy colours, a
 * preview that is not a tetromino) yields a low-confidence rejection with a
 * reason instead of a wrong board.
 *
 * Operates on a raw RGBA {@link Raster}; PNG decode/encode is a thin adapter
 * (`./png.ts`). The binary board stays colour-blind; colours are a parallel grid.
 */

import {
  ORIENTATIONS,
  PIECES,
  emptyBoard,
  emptyColorGrid,
  type ColorGrid,
  type Grid,
  type Piece,
} from '@trainer/core';

/** A raw RGBA image: `data` is `width*height*4` bytes, row-major from the top. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Pixel geometry of the canonical capture (see module doc). */
export interface Layout {
  /** Side of one board/preview cell in pixels. */
  cell: number;
  /** Board top-left in pixels. */
  boardX: number;
  boardY: number;
  /** Current-piece preview box top-left. */
  currentX: number;
  currentY: number;
  /** Next-piece preview box top-left. */
  nextX: number;
  nextY: number;
  /** Level readout (two digit slots) top-left. */
  levelX: number;
  levelY: number;
  /** Full image dimensions. */
  width: number;
  height: number;
}

const CELL = 6;
const MARGIN = 6;
const BOARD_W = 10;
const BOARD_H = 20;
const PREVIEW_X = MARGIN + BOARD_W * CELL + MARGIN; // right of the board

/** The canonical capture layout the play app emits and the parser expects. */
export const DEFAULT_LAYOUT: Layout = {
  cell: CELL,
  boardX: MARGIN,
  boardY: MARGIN,
  currentX: PREVIEW_X,
  currentY: MARGIN,
  nextX: PREVIEW_X,
  nextY: MARGIN + 4 * CELL + MARGIN,
  levelX: PREVIEW_X,
  levelY: MARGIN + 8 * CELL + 2 * MARGIN,
  width: PREVIEW_X + 7 * CELL + MARGIN, // room for two 3-wide digits + a gap
  height: MARGIN + BOARD_H * CELL + MARGIN,
};

/** NES colour groups → a representative RGB; index 0 is empty (background). */
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], // 0 empty / background (black well)
  [252, 252, 252], // 1 white group (T, O, I)
  [216, 40, 0], // 2 red group (Z, L)
  [0, 88, 248], // 3 blue group (J, S)
];

/** A 3×5 bitmap font for the level digits (rows top→bottom, '1' = lit). */
const DIGIT_FONT: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '100', '100'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

const DIGIT_W = 3;
const DIGIT_H = 5;
const DIGIT_SLOTS = 2;

/** A cell whose nearest-palette distance exceeds this is "ambiguous" (a misread). */
const MAX_COLOR_DIST = 120;
/** Reject below this fraction of cleanly-classified board cells. */
const MIN_BOARD_CONFIDENCE = 0.97;

/** A parsed screenshot: enough to feed the generation pipeline as a candidate. */
export interface ParsedScreenshot {
  board: Grid;
  colors: ColorGrid;
  currentPiece: Piece;
  nextPiece: Piece;
  level: number;
  /** Fraction of board cells classified cleanly (1 = perfect). */
  confidence: number;
}

/** OCR outcome: a parse, or a rejection carrying a reason (never a misread bank). */
export type OcrResult =
  | { ok: true; parsed: ParsedScreenshot }
  | { ok: false; reason: string; confidence: number };

function setPixel(r: Raster, x: number, y: number, rgb: readonly [number, number, number]): void {
  if (x < 0 || x >= r.width || y < 0 || y >= r.height) return;
  const i = (y * r.width + x) * 4;
  r.data[i] = rgb[0];
  r.data[i + 1] = rgb[1];
  r.data[i + 2] = rgb[2];
  r.data[i + 3] = 255;
}

function fillRect(
  r: Raster,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: readonly [number, number, number],
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(r, x, y, rgb);
  }
}

/** The colour at the centre of the cell whose top-left pixel is `(px, py)`. */
function cellColor(r: Raster, px: number, py: number, cell: number): [number, number, number] {
  const x = Math.floor(px + cell / 2);
  const y = Math.floor(py + cell / 2);
  const i = (Math.min(Math.max(y, 0), r.height - 1) * r.width + Math.min(Math.max(x, 0), r.width - 1)) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
}

/** Nearest palette group (0 = empty) and its squared-ish distance for a colour. */
function classify(rgb: readonly [number, number, number]): { group: number; dist: number } {
  let best = 0;
  let bestDist = Infinity;
  for (let g = 0; g < PALETTE.length; g++) {
    const [pr, pg, pb] = PALETTE[g];
    const d = Math.sqrt((rgb[0] - pr) ** 2 + (rgb[1] - pg) ** 2 + (rgb[2] - pb) ** 2);
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return { group: best, dist: bestDist };
}

/**
 * Render a parsed position into the canonical capture layout — the inverse of
 * {@link parseScreenshot}. The "known screenshot" generator for tests and the
 * documentation of the on-disk format the play app must emit.
 */
export function renderScreenshot(
  parsed: Pick<ParsedScreenshot, 'board' | 'colors' | 'currentPiece' | 'nextPiece' | 'level'>,
  layout: Layout = DEFAULT_LAYOUT,
): Raster {
  const raster: Raster = {
    width: layout.width,
    height: layout.height,
    data: new Uint8Array(layout.width * layout.height * 4),
  };
  fillRect(raster, 0, 0, layout.width, layout.height, PALETTE[0]); // black well

  // Board: each filled cell painted its colour group (default white if unset).
  for (let row = 0; row < BOARD_H; row++) {
    for (let col = 0; col < BOARD_W; col++) {
      if (!parsed.board[row][col]) continue;
      const group = parsed.colors[row]?.[col] || 1;
      fillRect(
        raster,
        layout.boardX + col * layout.cell,
        layout.boardY + row * layout.cell,
        layout.cell,
        layout.cell,
        PALETTE[group] ?? PALETTE[1],
      );
    }
  }

  drawPiece(raster, parsed.currentPiece, layout.currentX, layout.currentY, layout);
  drawPiece(raster, parsed.nextPiece, layout.nextX, layout.nextY, layout);
  drawLevel(raster, parsed.level, layout);
  return raster;
}

const PIECE_GROUP_RENDER: Record<Piece, number> = { T: 1, O: 1, I: 1, Z: 2, L: 2, J: 3, S: 3 };

function drawPiece(r: Raster, piece: Piece, ox: number, oy: number, layout: Layout): void {
  const group = PIECE_GROUP_RENDER[piece];
  for (const [cr, cc] of ORIENTATIONS[piece][0]) {
    fillRect(r, ox + cc * layout.cell, oy + cr * layout.cell, layout.cell, layout.cell, PALETTE[group]);
  }
}

function drawLevel(r: Raster, level: number, layout: Layout): void {
  const digits = String(Math.max(0, Math.min(99, Math.floor(level)))).slice(-DIGIT_SLOTS);
  for (let slot = 0; slot < digits.length; slot++) {
    const glyph = DIGIT_FONT[digits[slot]];
    const ox = layout.levelX + slot * (DIGIT_W + 1) * layout.cell;
    for (let gr = 0; gr < DIGIT_H; gr++) {
      for (let gc = 0; gc < DIGIT_W; gc++) {
        if (glyph[gr][gc] === '1') {
          fillRect(r, ox + gc * layout.cell, layout.levelY + gr * layout.cell, layout.cell, layout.cell, PALETTE[1]);
        }
      }
    }
  }
}

/** Read a 4×4 preview box and identify the tetromino + colour group, or null. */
function parsePiece(r: Raster, ox: number, oy: number, layout: Layout): { piece: Piece; group: number } | null {
  const filled: Array<[number, number]> = [];
  const groups: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const { group, dist } = classify(cellColor(r, ox + col * layout.cell, oy + row * layout.cell, layout.cell));
      if (group !== 0) {
        if (dist > MAX_COLOR_DIST) return null; // a smudged, non-palette preview
        filled.push([row, col]);
        groups.push(group);
      }
    }
  }
  if (filled.length !== 4) return null;
  const minR = Math.min(...filled.map(([rr]) => rr));
  const minC = Math.min(...filled.map(([, cc]) => cc));
  const key = (cells: ReadonlyArray<readonly [number, number]>) =>
    cells
      .map(([rr, cc]) => `${rr - Math.min(...cells.map((p) => p[0]))},${cc - Math.min(...cells.map((p) => p[1]))}`)
      .sort()
      .join('|');
  const got = filled.map(([rr, cc]) => [rr - minR, cc - minC] as [number, number]);
  const gotKey = key(got);
  for (const piece of PIECES) {
    if (key(ORIENTATIONS[piece][0]) === gotKey) {
      // Colour group = the most common across the four preview cells.
      const counts = new Map<number, number>();
      for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
      const group = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { piece, group };
    }
  }
  return null;
}

/** Read the level readout (two digit slots) into a number, or null if unreadable. */
function parseLevel(r: Raster, layout: Layout): number | null {
  let out = '';
  for (let slot = 0; slot < DIGIT_SLOTS; slot++) {
    const ox = layout.levelX + slot * (DIGIT_W + 1) * layout.cell;
    let lit = 0;
    const rows: string[] = [];
    for (let gr = 0; gr < DIGIT_H; gr++) {
      let line = '';
      for (let gc = 0; gc < DIGIT_W; gc++) {
        const { group } = classify(cellColor(r, ox + gc * layout.cell, layout.levelY + gr * layout.cell, layout.cell));
        const on = group !== 0;
        line += on ? '1' : '0';
        if (on) lit++;
      }
      rows.push(line);
    }
    if (lit === 0) continue; // blank slot (single-digit level)
    const match = Object.keys(DIGIT_FONT).find((d) => DIGIT_FONT[d].join('|') === rows.join('|'));
    if (!match) return null; // a non-empty slot that is not a clean digit
    out += match;
  }
  return out.length ? Number(out) : null;
}

/**
 * Parse a screenshot into a position, or reject it (with a reason and the
 * board-confidence) when the image is off-format or too noisy to trust. The
 * binary board and the parallel colour grid are returned together.
 */
export function parseScreenshot(raster: Raster, layout: Layout = DEFAULT_LAYOUT): OcrResult {
  if (raster.width !== layout.width || raster.height !== layout.height) {
    return { ok: false, reason: 'unexpected-dimensions', confidence: 0 };
  }

  const board = emptyBoard();
  const colors = emptyColorGrid();
  let clean = 0;
  for (let row = 0; row < BOARD_H; row++) {
    for (let col = 0; col < BOARD_W; col++) {
      const { group, dist } = classify(
        cellColor(raster, layout.boardX + col * layout.cell, layout.boardY + row * layout.cell, layout.cell),
      );
      if (dist <= MAX_COLOR_DIST) clean++;
      if (group !== 0 && dist <= MAX_COLOR_DIST) {
        board[row][col] = 1;
        colors[row][col] = group;
      }
    }
  }
  const confidence = clean / (BOARD_W * BOARD_H);
  if (confidence < MIN_BOARD_CONFIDENCE) {
    return { ok: false, reason: 'low-confidence-board', confidence };
  }

  const current = parsePiece(raster, layout.currentX, layout.currentY, layout);
  if (!current) return { ok: false, reason: 'unreadable-current-piece', confidence };
  const next = parsePiece(raster, layout.nextX, layout.nextY, layout);
  if (!next) return { ok: false, reason: 'unreadable-next-piece', confidence };

  const level = parseLevel(raster, layout);
  if (level === null) return { ok: false, reason: 'unreadable-level', confidence };

  return {
    ok: true,
    parsed: {
      board,
      colors,
      currentPiece: current.piece,
      nextPiece: next.piece,
      level,
      confidence,
    },
  };
}
