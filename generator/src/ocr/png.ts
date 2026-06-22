/**
 * PNG ⇄ {@link Raster} adapter (#45) — the only place a real image format is
 * touched. Kept thin and separate so the OCR core (`./screenshot.ts`) stays a
 * pure raster function that tests can exercise without encoding a PNG.
 *
 * Offline only (the generator); the play app never imports this.
 */

import { PNG } from 'pngjs';
import type { Raster } from './screenshot.js';

/**
 * Decompression-bomb guard (#67): the upload is untrusted, and a tiny PNG can
 * declare enormous dimensions that decode to a huge RGBA buffer. We read the
 * IHDR width/height from the header and refuse to decode anything beyond these
 * caps — generous for a real NES screenshot, far below an OOM. RGBA at the cap is
 * ~96 MB, a hard ceiling on the allocation the decoder can be tricked into.
 */
export const MAX_IMAGE_DIMENSION = 8000;
export const MAX_IMAGE_PIXELS = 24_000_000;

/** Read the IHDR width/height of a PNG without decoding its pixel data. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // 8-byte signature, then IHDR: 4 len + 4 "IHDR" + width(4) + height(4).
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Decode PNG bytes into a raw RGBA raster, refusing decompression bombs. */
export function decodePng(bytes: Uint8Array): Raster {
  const dims = pngDimensions(bytes);
  if (!dims) throw new Error('decodePng: not a PNG (no IHDR)');
  const { width, height } = dims;
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(`decodePng: image dimensions ${width}×${height} exceed the safe limit`);
  }
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

/** Encode a raw RGBA raster into PNG bytes. */
export function encodePng(raster: Raster): Uint8Array {
  const png = new PNG({ width: raster.width, height: raster.height });
  png.data = Buffer.from(raster.data);
  return new Uint8Array(PNG.sync.write(png));
}
