/**
 * Matchmaking selection (#44) — pick the next puzzle near the player's rating,
 * excluding recently-seen ones (the anti-repeat cooldown). Pure and engine-free:
 * the band query is injected as `fetchInBand`, so the widening + cooldown +
 * random-pick logic is testable without a live Supabase. The data-access layer
 * wires the real query (see {@link createDataAccess}); the play app supplies the
 * player's rating and the cooldown window of just-played ids.
 *
 * Domain: docs/glossary.md "Matchmaking" / "Anti-repeat cooldown".
 */

import type { Puzzle } from './types.js';

export interface MatchmakeOptions {
  /** The player's current rating; the band is centred here. */
  rating: number;
  /** Puzzle ids to exclude — the recently-seen cooldown window. */
  recentIds?: readonly string[];
  /** Initial band half-width (default 100). */
  band?: number;
  /** Stop widening once the half-width reaches this (default 1200). */
  maxBand?: number;
  /** Widen until at least this many in-band, non-cooldown candidates exist (default 1). */
  minCandidates?: number;
  /** Injectable RNG in [0, 1) for deterministic tests (default Math.random). */
  random?: () => number;
}

/**
 * Choose one puzzle whose rating sits near the player's, excluding cooldown ids.
 *
 * `fetchInBand(min, max)` returns every puzzle whose rating lies in `[min, max]`.
 * The band starts at `opts.band` and doubles until it holds at least
 * `minCandidates` puzzles outside the cooldown, or the `maxBand` cap is hit. One
 * candidate is then picked uniformly at random. When the band reaches the cap
 * with only cooldown puzzles in range, the cooldown is relaxed as a last resort
 * (a stale puzzle beats an empty board), so this returns `null` only when no
 * puzzle exists in range at all.
 */
export async function selectMatchmadePuzzle(
  fetchInBand: (min: number, max: number) => Promise<Puzzle[]>,
  opts: MatchmakeOptions,
): Promise<Puzzle | null> {
  const recent = new Set(opts.recentIds ?? []);
  const minCandidates = Math.max(1, opts.minCandidates ?? 1);
  const maxBand = opts.maxBand ?? 1200;
  const rng = opts.random ?? Math.random;
  let band = opts.band ?? 100;

  let inBand: Puzzle[] = [];
  let candidates: Puzzle[] = [];
  for (;;) {
    inBand = await fetchInBand(opts.rating - band, opts.rating + band);
    candidates = inBand.filter((p) => !recent.has(p.id));
    if (candidates.length >= minCandidates || band >= maxBand) break;
    band *= 2;
  }

  // Relax the cooldown only when nothing else is left in range.
  const pool = candidates.length > 0 ? candidates : inBand;
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)] ?? null;
}

/**
 * The persistent anti-repeat window (#74). Given puzzle ids ordered
 * newest-first (with repeats — one row per attempt), keep the first occurrence
 * of each id in order and cap the result at `limit`. The output is the most
 * recently-attempted DISTINCT puzzle ids, newest-first — the sliding window fed
 * to {@link selectMatchmadePuzzle} as `recentIds`. Pure so the derivation is
 * testable without a live Supabase, and deterministic so a reload reproduces the
 * same window (docs/decisions.md 2026-06-23, grill-with-docs #7).
 */
export function distinctRecent(idsNewestFirst: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of idsNewestFirst) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}
