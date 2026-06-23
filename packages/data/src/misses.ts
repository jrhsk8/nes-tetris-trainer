/**
 * Miss replay (#75) — the pure logic behind "review the ones you got wrong."
 *
 * A **miss** is a puzzle the player has attempted at least once but never solved;
 * it leaves the miss set the moment it is finally solved. These helpers derive
 * the miss set from the player's attempts and decide when to resurface a miss in
 * normal play. Pure and engine-free, so the selection logic is testable without
 * a live Supabase (the data-access layer feeds them real rows).
 *
 * Domain: .claude/docs/glossary.md "Miss replay" / "Miss"; .claude/docs/decisions.md 2026-06-23.
 */

/** The minimal attempt shape the miss derivation reads (ascending by created_at). */
export interface MissAttempt {
  puzzleId: string;
  solved: boolean;
}

/**
 * The miss set: puzzle ids with ≥1 attempt and **no** solved attempt, ordered
 * **oldest-first** (by the earliest attempt of each puzzle). `attemptsAsc` must
 * be ascending by `created_at`, so first appearance = earliest attempt.
 */
export function missPuzzleIds(attemptsAsc: readonly MissAttempt[]): string[] {
  const solved = new Set<string>();
  const seen = new Set<string>();
  const order: string[] = [];
  for (const a of attemptsAsc) {
    if (!seen.has(a.puzzleId)) {
      seen.add(a.puzzleId);
      order.push(a.puzzleId);
    }
    if (a.solved) solved.add(a.puzzleId);
  }
  return order.filter((id) => !solved.has(id));
}

/**
 * The misses that are **due** for resurfacing in normal play: those that have
 * fallen OUT of the anti-repeat window (#74), preserving the oldest-first order.
 * A miss still inside the window is being served recently enough already.
 */
export function dueMisses(
  misses: readonly string[],
  recentWindow: readonly string[],
): string[] {
  const recent = new Set(recentWindow);
  return misses.filter((id) => !recent.has(id));
}

/** The gentle auto-injection rate (#75): ~1 in 10 normal serves resurface a miss. */
export const MISS_INJECT_RATE = 0.1;

/**
 * Whether this normal serve should inject the oldest due miss instead of a fresh
 * puzzle: rate-gated by {@link MISS_INJECT_RATE} and only when at least one miss
 * is due. `random` is a draw in `[0, 1)`.
 */
export function shouldInjectMiss(random: number, dueCount: number): boolean {
  return dueCount > 0 && random < MISS_INJECT_RATE;
}
