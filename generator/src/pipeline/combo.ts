/**
 * Two-piece combo evaluation (#33, rewired for v2 in #40).
 *
 * A puzzle is "find the best two-piece combo." The generator sweeps the FULL
 * cross-product of legal placements — every collision-reachable resting
 * placement of piece 1 × every reachable resting placement of piece 2 on the
 * resulting board (tucks and spins included, via @trainer/core reachability,
 * #37) — and values each combo by StackRabbit's evaluation of the board after
 * BOTH placements. Combos are keyed by their **resulting board** (the canonical
 * outcome key, #37): two placement paths that land the same cells are the SAME
 * answer, so they collapse to one entry. Values are field-normalized to 0–100
 * (best = 100, worst legal = 0) and the top-K are stored with their `boardKey`
 * for outcome-matching at play time (#42).
 *
 * Engine-only: this module runs in the offline generator and never ships to the
 * play app (CLAUDE.md guardrail). It reuses the typed engine client (#4).
 */

import {
  PIECES,
  applyRestingPlacement,
  enumerateResting,
  boardKey,
  boardMetrics,
  CORRECT_SCORE_THRESHOLD,
  type Grid,
  type Piece,
  type RestingPlacement,
} from '@trainer/core';
import type { ComboEntry, ComboTable } from '@trainer/data';
import type { EngineMove, MoveQuery, RateMoveOptions, RateMoveResult } from '../engine/client.js';

/** The slice of the engine client combo evaluation needs. */
export interface ComboEngine {
  getBestMove(query: MoveQuery): Promise<EngineMove | null>;
  rateMove(
    query: MoveQuery,
    playerBoardAfter: Grid,
    options?: RateMoveOptions,
  ): Promise<RateMoveResult>;
}

/** A candidate position: a board plus the two pieces to place and its context. */
export interface ComboContext {
  board: Grid;
  piece1: Piece;
  piece2: Piece;
  level: number;
  lines: number;
}

/**
 * One swept combo: both resting placements (rotation + board offset, so tucks
 * and spins are expressible, #37), the raw engine value of the combo, the board
 * after both placements (kept so the rank-1 combo's result metrics can be
 * computed without re-applying), and the canonical outcome key of that board.
 */
export interface ScoredCombo {
  p1: RestingPlacement;
  p2: RestingPlacement;
  /** Raw engine value (the second move's rate-move `playerValue`). */
  value: number;
  /** The board after both placements (line clears included). */
  board2: Grid;
  /** Canonical outcome key of `board2` (#37) — the matching key (#42). */
  boardKey: string;
}

/**
 * The board-health floor signal (#33): the MINIMUM over the 7 piece types of
 * `getBestMove(board, piece).totalValue` — i.e. how good the board is to build
 * on for its *worst* possible next piece. Piece-independent on purpose, so an
 * awkward puzzle piece draw doesn't reject an otherwise good board. Returns
 * `-Infinity` if any piece has no legal move or no finite value (a board that
 * bad is unfair — the v2 floor is relaxed to reject only this garbage, #40).
 */
export async function boardHealth(
  engine: ComboEngine,
  board: Grid,
  level: number,
  lines: number,
  timeline: string,
): Promise<number> {
  let min = Number.POSITIVE_INFINITY;
  for (const piece of PIECES) {
    const move = await engine.getBestMove({
      board,
      currentPiece: piece,
      nextPiece: null,
      level,
      lines,
      inputFrameTimeline: timeline,
    });
    const value = move?.totalValue ?? Number.NaN;
    if (!Number.isFinite(value)) return Number.NEGATIVE_INFINITY;
    if (value < min) min = value;
  }
  return Number.isFinite(min) ? min : Number.NEGATIVE_INFINITY;
}

/**
 * Sweep the full cross-product of legal two-piece combos on `ctx.board`,
 * enumerating EVERY collision-reachable resting placement of each piece (#37) so
 * tucks and spins are candidates, and valuing each by the second move's
 * `rate-move` value at `timeline`. Combos the engine cannot value (a placement
 * unreachable under the timeline — `rate-move` reports "player move not found")
 * are skipped. Combos that land the SAME resulting board collapse to one entry
 * (keyed by `boardKey`), keeping the best value. Returned best-first by value.
 */
export async function sweepCombos(
  engine: ComboEngine,
  ctx: ComboContext,
  timeline: string,
): Promise<ScoredCombo[]> {
  const { board, piece1, piece2, level, lines } = ctx;
  const byOutcome = new Map<string, ScoredCombo>();

  for (const p1 of enumerateResting(board, piece1)) {
    const board1 = applyRestingPlacement(board, piece1, p1);
    const query2: MoveQuery = {
      board: board1,
      currentPiece: piece2,
      nextPiece: null,
      level,
      lines,
      inputFrameTimeline: timeline,
    };
    for (const p2 of enumerateResting(board1, piece2)) {
      const board2 = applyRestingPlacement(board1, piece2, p2);
      let value: number;
      try {
        value = (await engine.rateMove(query2, board2)).playerValue;
      } catch {
        continue; // unreachable under this timeline — not a fair combo.
      }
      if (!Number.isFinite(value)) continue;
      const key = boardKey(board2);
      const existing = byOutcome.get(key);
      if (!existing || value > existing.value) {
        byOutcome.set(key, { p1, p2, value, board2, boardKey: key });
      }
    }
  }

  const combos = [...byOutcome.values()];
  combos.sort((a, b) => b.value - a.value);
  return combos;
}

/**
 * Display slope (eval units → points), pinned at k = 0.625 (#47). Held FIXED
 * across the 95 → 97 A+/win-line move (#60, grill #5): the curve shape and slope
 * don't change, only the accept cutoff. Originally 5/8 at the 95 threshold with
 * an 8-unit margin; pinned here so it stays 0.625 now that the threshold is 97.
 */
export const SCORE_SLOPE = 0.625;

/**
 * The raw StackRabbit eval gap (`bestValue − value`) at which a combo stops
 * being graded correct (#47), derived from the pinned slope so `score ≥
 * CORRECT_SCORE_THRESHOLD` is exactly equivalent to `gap ≤ CORRECT_GAP_MARGIN`.
 * At the 97 threshold this is (100 − 97)/0.625 = **4.8** eval units (was 8 at the
 * 95 threshold). The slope was chosen from sampled real bank gaps (see
 * `generator/src/gap-sample.ts` + docs/decisions.md 2026-06-21 #47): a clean but
 * slightly bumpier line costs ~4–8 eval units, a hole-burying move ~12–22.
 */
export const CORRECT_GAP_MARGIN = (100 - CORRECT_SCORE_THRESHOLD) / SCORE_SLOPE;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

/**
 * Score ranked combos by their **gap from the rank-1 optimal** (#47), in raw
 * StackRabbit eval units: `score = clamp(100 − k·(rank1Value − value), 0, 100)`.
 * `combos` is the stored rank order (best-first), so the anchor is `combos[0]` —
 * the optimal the player is graded against — NOT the raw max value. The two are
 * identical in the common case (rank-1 is the value-best), but when the
 * dominance-respecting re-rank (#50) seats a cleaner, slightly-lower-value combo
 * at rank-1, anchoring on it keeps the **rank-1 score exactly 100** (a
 * higher-value demoted combo clamps to 100, never above). The worst-legal anchor
 * is dropped, so the SAME absolute gap yields the SAME score on every puzzle
 * (cross-puzzle comparable). Scores are **floats** (#60 — the round() is dropped
 * so the player view can show a one-decimal number behind the letter grade);
 * `correct = score ≥ CORRECT_SCORE_THRESHOLD` is equivalent to `gap ≤
 * CORRECT_GAP_MARGIN`. Ties (or a single combo) all score 100.
 */
export function normalizedScores(combos: readonly ScoredCombo[]): number[] {
  if (combos.length === 0) return [];
  const rank1Value = combos[0].value;
  return combos.map((c) => clampScore(100 - SCORE_SLOPE * (rank1Value - c.value)));
}

/**
 * Normalize swept combos and keep the top `topK`, best-first, alongside the
 * total ranked count. Each stored entry carries its placements (for replay) and
 * the canonical `boardKey` (for outcome-matching, #42). The rank-1 combo always
 * scores exactly 100.
 */
export function normalizeCombos(combos: readonly ScoredCombo[], topK: number): ComboTable {
  if (combos.length === 0) return { entries: [], total: 0 };
  const scores = normalizedScores(combos);
  // The stored list is in dominance-respecting rank order (#50), which can place
  // a cleaner-but-lower-value combo above a higher-value one; clamp so the
  // displayed scores stay non-increasing with rank (rank-1 always 100).
  let ceiling = Number.POSITIVE_INFINITY;
  const entries: ComboEntry[] = combos.slice(0, topK).map((c, i) => {
    const score = Math.min(scores[i], ceiling);
    ceiling = score;
    return {
      rot1: c.p1.rotation,
      col1: c.p1.col,
      rot2: c.p2.rotation,
      col2: c.p2.col,
      score,
      boardKey: c.boardKey,
    };
  });
  return { entries, total: combos.length };
}

/**
 * Cleanliness of a combo's resulting board (#50): holes and the tallest column.
 * All combos on one puzzle share `board0`, so these are directly comparable
 * across a puzzle's combos (the inherited holes/height cancel) — a board0-
 * independent measure of which combo leaves the cleaner stack.
 */
export interface ComboCleanliness {
  holes: number;
  maxHeight: number;
}

/** Holes + tallest column of a combo's resulting board. */
export function comboCleanliness(combo: ScoredCombo): ComboCleanliness {
  const m = boardMetrics(combo.board2);
  return { holes: m.holes, maxHeight: m.columnHeights.length ? Math.max(...m.columnHeights) : 0 };
}

/**
 * Holes-dominance on cleanliness (#50): `a` strictly out-cleans `b` when it has
 * strictly FEWER holes and is no taller. Buried holes (unlike a couple of extra
 * rows of height, which the engine eval legitimately trades for board shape) are
 * almost never a justified "optimal", so a board that is strictly holier AND no
 * shorter must never outrank a cleaner one — the value-sanity invariant.
 */
export function holesDominate(a: ComboCleanliness, b: ComboCleanliness): boolean {
  return a.holes < b.holes && a.maxHeight <= b.maxHeight;
}

/**
 * Rank swept combos by a **dominance-respecting** order (#50): a topological
 * sort of the {@link holesDominate} partial order (cleaner-on-holes first),
 * tie-broken by raw engine value. Guarantees the value-sanity invariant — a board
 * with strictly more holes AND no-lower height can never be placed above a
 * cleaner one — while otherwise preserving the engine's value ranking (which
 * captures board shape beyond raw height). In the common case (no holes
 * conflicts) this is exactly the value order.
 */
export function rankCombosBySanity(combos: readonly ScoredCombo[]): ScoredCombo[] {
  const n = combos.length;
  if (n <= 1) return [...combos];
  const clean = combos.map(comboCleanliness);
  // Kahn's algorithm over the domination DAG: domCount[i] = remaining dominators
  // of i; place a node only once all its dominators are placed.
  const domCount = new Array<number>(n).fill(0);
  const dominates: number[][] = Array.from({ length: n }, () => []);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (i !== j && holesDominate(clean[j], clean[i])) {
        domCount[i]++;
        dominates[j].push(i);
      }
    }
  }
  const placed = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (placed[i] || domCount[i] > 0) continue;
      if (pick === -1 || combos[i].value > combos[pick].value) pick = i;
    }
    placed[pick] = true;
    order.push(pick);
    for (const i of dominates[pick]) if (!placed[i]) domCount[i]--;
  }
  return order.map((i) => combos[i]);
}

/** Tuning for the rank-1 outcome-quality gate (#50). */
export interface Rank1QualityConfig {
  /** Reject when a no-taller alternative has at least this many FEWER holes. */
  holeMargin: number;
  /** A rank-1 column at least this tall is a candidate "tower". */
  towerMinHeight: number;
  /** ...and is rejected if a swept alternative is at least this much shorter. */
  towerHeightMargin: number;
}

export const DEFAULT_RANK1_QUALITY: Rank1QualityConfig = {
  holeMargin: 3,
  towerMinHeight: 12,
  towerHeightMargin: 4,
};

/**
 * The outcome-quality gate (#50): why a candidate's rank-1 (value-best) combo is
 * an EGREGIOUSLY bad "optimal" relative to what the sweep itself found, or `null`
 * when it is acceptable. Both checks are board0-independent (every combo shares
 * board0), and both target the real bug — a degenerate tower/holey board crowned
 * #1 — without rejecting the legitimate majority where the engine trades a couple
 * of rows of height for better board shape:
 *
 *  - `rank1-holey` — a no-taller swept alternative has ≥ `holeMargin` FEWER holes.
 *    The stored optimal needlessly buries holes a cleaner line avoids.
 *  - `rank1-tower` — rank-1 is a tall tower (≥ `towerMinHeight`) when a swept
 *    alternative is materially shorter (≥ `towerHeightMargin`).
 *
 * StackRabbit's eval-only value occasionally crowns such a board #1; this gate
 * rejects the whole puzzle rather than bank a bad "optimal".
 */
export function rank1QualityReason(
  best: ScoredCombo,
  combos: readonly ScoredCombo[],
  config: Rank1QualityConfig = DEFAULT_RANK1_QUALITY,
): string | null {
  const cb = comboCleanliness(best);
  const others = combos.filter((c) => c !== best).map(comboCleanliness);
  if (others.some((c) => c.maxHeight <= cb.maxHeight && cb.holes - c.holes >= config.holeMargin)) {
    return 'rank1-holey';
  }
  if (
    cb.maxHeight >= config.towerMinHeight &&
    others.some((c) => c.maxHeight <= cb.maxHeight - config.towerHeightMargin)
  ) {
    return 'rank1-tower';
  }
  return null;
}

/**
 * Whether a resting placement is collision-reachable on a board — the narrowed
 * Hz-invariance check (#40): tuck/spin *capability* is granted (v2 free-
 * positioning input has no timer, so horizontal-traverse speed never blocks the
 * player), so the surviving requirement is simply that the stored optimal is a
 * genuinely reachable resting placement (the binding superset invariant, #37).
 * `sweepCombos` only emits reachable placements, so this guards the rank-1 combo
 * against any non-reachability-filtered source.
 */
export function isReachablePlacement(
  board: Grid,
  piece: Piece,
  placement: RestingPlacement,
): boolean {
  return enumerateResting(board, piece).some(
    (p) => p.rotation === placement.rotation && p.row === placement.row && p.col === placement.col,
  );
}

/** A combo scoring at least this counts as an acceptable answer (mirrors core). */
export { CORRECT_SCORE_THRESHOLD };
