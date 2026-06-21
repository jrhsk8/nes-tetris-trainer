import { describe, it, expect } from 'vitest';
import { emptyBoard, emptyColorGrid } from '@trainer/core';
import {
  DEFAULT_LAYOUT,
  parseScreenshot,
  renderScreenshot,
  type Raster,
} from './screenshot.js';

/** A known position: a couple of coloured rows plus current/next pieces + level. */
function knownPosition() {
  const board = emptyBoard();
  const colors = emptyColorGrid();
  // Bottom row partly filled (red group), a blue cell above it.
  for (const c of [0, 1, 2, 3]) {
    board[19][c] = 1;
    colors[19][c] = 2;
  }
  board[18][0] = 1;
  colors[18][0] = 3;
  board[17][9] = 1;
  colors[17][9] = 1; // a lone white cell at the far column
  return { board, colors, currentPiece: 'T' as const, nextPiece: 'I' as const, level: 18 };
}

describe('screenshot OCR round-trip (#45)', () => {
  it('parses a rendered screenshot back to the exact board, pieces, and level', () => {
    const pos = knownPosition();
    const raster = renderScreenshot(pos);
    const result = parseScreenshot(raster);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.board).toEqual(pos.board);
    expect(result.parsed.colors).toEqual(pos.colors);
    expect(result.parsed.currentPiece).toBe('T');
    expect(result.parsed.nextPiece).toBe('I');
    expect(result.parsed.level).toBe(18);
    expect(result.parsed.confidence).toBe(1);
  });

  it('round-trips every piece in the current/next slots', () => {
    for (const piece of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const) {
      const raster = renderScreenshot({
        board: emptyBoard(),
        colors: emptyColorGrid(),
        currentPiece: piece,
        nextPiece: piece,
        level: 9,
      });
      const result = parseScreenshot(raster);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.parsed.currentPiece).toBe(piece);
        expect(result.parsed.nextPiece).toBe(piece);
        expect(result.parsed.level).toBe(9);
      }
    }
  });
});

describe('screenshot OCR rejects bad images (#45)', () => {
  it('rejects a noisy, off-palette image with low board confidence', () => {
    // A flat mid-grey raster matches no palette colour cleanly.
    const raster: Raster = {
      width: DEFAULT_LAYOUT.width,
      height: DEFAULT_LAYOUT.height,
      data: new Uint8Array(DEFAULT_LAYOUT.width * DEFAULT_LAYOUT.height * 4).fill(128),
    };
    const result = parseScreenshot(raster);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('low-confidence-board');
      expect(result.confidence).toBeLessThan(1);
    }
  });

  it('rejects an image of the wrong dimensions', () => {
    const raster: Raster = { width: 10, height: 10, data: new Uint8Array(10 * 10 * 4) };
    const result = parseScreenshot(raster);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unexpected-dimensions');
  });

  it('rejects when a preview box is not a valid tetromino', () => {
    const raster = renderScreenshot({
      board: emptyBoard(),
      colors: emptyColorGrid(),
      currentPiece: 'T',
      nextPiece: 'I',
      level: 5,
    });
    // Corrupt the current-piece box: paint a single extra cell so it has 5 cells.
    const { cell, currentX, currentY, width } = DEFAULT_LAYOUT;
    const px = currentX + 3 * cell + Math.floor(cell / 2);
    const py = currentY + 3 * cell + Math.floor(cell / 2);
    const i = (py * width + px) * 4;
    raster.data[i] = 252;
    raster.data[i + 1] = 252;
    raster.data[i + 2] = 252;
    const result = parseScreenshot(raster);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unreadable-current-piece');
  });
});
