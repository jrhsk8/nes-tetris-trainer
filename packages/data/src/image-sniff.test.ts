import { describe, it, expect } from 'vitest';
import { sniffImageMime, extensionFor, MAX_UPLOAD_BYTES } from './image-sniff.js';

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]);

describe('sniffImageMime (#67)', () => {
  it('identifies a PNG by its magic bytes', () => {
    expect(sniffImageMime(png())).toBe('image/png');
    expect(extensionFor('image/png')).toBe('png');
  });

  it('identifies a JPEG by its magic bytes', () => {
    expect(sniffImageMime(jpeg())).toBe('image/jpeg');
    expect(extensionFor('image/jpeg')).toBe('jpg');
  });

  it('rejects an SVG (XML text) — not a raster image', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImageMime(svg)).toBeNull();
  });

  it('rejects a polyglot that does not START as a real image', () => {
    // A file that claims to be a GIF (or HTML) but is not PNG/JPEG by signature.
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(sniffImageMime(gif)).toBeNull();
    const tooShort = new Uint8Array([0x89, 0x50]);
    expect(sniffImageMime(tooShort)).toBeNull();
  });

  it('caps the upload size at 5 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });
});
