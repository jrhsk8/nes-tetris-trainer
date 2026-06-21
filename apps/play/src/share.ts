/**
 * Shareable puzzle links (#49). A puzzle's stable {@link Puzzle.number} encodes
 * into a `?puzzle=N` query param so a link opens that exact puzzle for someone
 * else. A query param survives GitHub Pages with no SPA server rewrite, and
 * `import.meta.env.BASE_URL` keeps the link under the Vite `base`
 * (`/nes-tetris-trainer/`).
 */

/** The query-string key carrying a shared puzzle's number. */
export const PUZZLE_PARAM = 'puzzle';

/**
 * Build a shareable URL that opens puzzle `number`. Respects the deployed base
 * path (injectable for tests; defaults to the Vite base + current origin).
 */
export function puzzleShareUrl(
  number: number,
  origin: string = window.location.origin,
  base: string = import.meta.env.BASE_URL,
): string {
  // Vite's BASE_URL always carries a trailing slash, e.g. '/nes-tetris-trainer/'.
  return `${origin}${base}?${PUZZLE_PARAM}=${number}`;
}

/**
 * Parse a shared puzzle number from a URL search string (e.g.
 * `window.location.search`). Returns the positive integer, or `null` when the
 * param is absent or not a clean positive integer — the caller then falls back
 * to normal matchmaking.
 */
export function parsePuzzleParam(search: string): number | null {
  const raw = new URLSearchParams(search).get(PUZZLE_PARAM);
  if (raw === null) return null;
  const trimmed = raw.trim();
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n > 0 && String(n) === trimmed ? n : null;
}
