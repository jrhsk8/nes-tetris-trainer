/**
 * Image magic-byte sniffing (#67) — identify an upload by its ACTUAL bytes, not
 * a client-claimed content-type or file extension. Used to (a) server-generate
 * the stored content-type on upload and (b) reject SVG/polyglot/non-image
 * uploads in the offline processor before any decode runs.
 *
 * Pure byte inspection — no decoding, no allocation beyond a few reads — so it is
 * safe to run on fully untrusted input.
 */

/** The only image types the submission pipeline accepts. */
export type AllowedImageMime = 'image/png' | 'image/jpeg';

/** The accepted MIME types, in the order the storage bucket allows them. */
export const ALLOWED_IMAGE_MIMES: readonly AllowedImageMime[] = ['image/png', 'image/jpeg'];

/** The maximum accepted upload size (#67): 5 MB, matching the bucket limit. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}

/**
 * The image MIME type of `bytes` by magic number, or `null` when the bytes are
 * not a PNG or JPEG (e.g. SVG, a PDF/HTML polyglot, or anything else). Only the
 * leading signature is read, so a polyglot that *starts* as something else is
 * rejected even if it embeds a valid image later.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png';
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg';
  return null;
}

/** The file extension for an accepted MIME type. */
export function extensionFor(mime: AllowedImageMime): 'png' | 'jpg' {
  return mime === 'image/png' ? 'png' : 'jpg';
}
