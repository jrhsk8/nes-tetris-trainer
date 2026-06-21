import { describe, it, expect } from 'vitest';
import { emptyBoard, emptyColorGrid } from '@trainer/core';
import { decodePng, encodePng } from './png.js';
import { parseScreenshot, renderScreenshot } from './screenshot.js';

describe('PNG adapter (#45)', () => {
  it('encodes a raster to PNG and decodes it back losslessly', () => {
    const board = emptyBoard();
    const colors = emptyColorGrid();
    board[19][4] = 1;
    colors[19][4] = 2;
    const raster = renderScreenshot({
      board,
      colors,
      currentPiece: 'L',
      nextPiece: 'O',
      level: 12,
    });

    const png = encodePng(raster);
    expect(png[0]).toBe(0x89); // PNG magic byte
    const decoded = decodePng(png);

    expect(decoded.width).toBe(raster.width);
    expect(decoded.height).toBe(raster.height);

    // The decoded PNG OCRs back to the same position — a true end-to-end image.
    const result = parseScreenshot(decoded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.board).toEqual(board);
      expect(result.parsed.currentPiece).toBe('L');
      expect(result.parsed.nextPiece).toBe('O');
      expect(result.parsed.level).toBe(12);
    }
  });
});
