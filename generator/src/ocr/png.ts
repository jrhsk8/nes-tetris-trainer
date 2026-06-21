/**
 * PNG ⇄ {@link Raster} adapter (#45) — the only place a real image format is
 * touched. Kept thin and separate so the OCR core (`./screenshot.ts`) stays a
 * pure raster function that tests can exercise without encoding a PNG.
 *
 * Offline only (the generator); the play app never imports this.
 */

import { PNG } from 'pngjs';
import type { Raster } from './screenshot.js';

/** Decode PNG bytes into a raw RGBA raster. */
export function decodePng(bytes: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

/** Encode a raw RGBA raster into PNG bytes. */
export function encodePng(raster: Raster): Uint8Array {
  const png = new PNG({ width: raster.width, height: raster.height });
  png.data = Buffer.from(raster.data);
  return new Uint8Array(PNG.sync.write(png));
}
