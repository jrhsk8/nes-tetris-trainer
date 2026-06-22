/**
 * Deeper-StackRabbit best-confirm gate (#53).
 *
 * The swept "optimal" (combo.ts) is StackRabbit's EVAL-ONLY (`playoutCount = 0`)
 * value-best over the two-piece cross-product. Eval-only is fast and good for
 * relative ranking, but it occasionally crowns a combo a deeper, lookahead-aware
 * search (`playoutCount > 0`) does not consider best — an "eval-only quirk". This
 * gate re-values ONLY the top-N contenders with a deeper search (bounded cost —
 * never the full sweep) and returns one of three decisions:
 *
 *  - `confirmed` — the deeper search agrees the eval-only pick is best (the common
 *    case), or disagrees only within noise (`< rerankMargin`). Keep it as-is.
 *  - `reranked`  — a different top-N combo is the deeper-best by a clear margin
 *    (`rerankMargin ≤ Δ < rejectMargin`). Promote it to the stored optimal.
 *  - `reject`    — the deeper-best beats the eval-only pick beyond `rejectMargin`:
 *    the eval-only #1 was a genuine quirk and the whole position is too unstable
 *    to bank a trustworthy "optimal" from. Drop the puzzle.
 *
 * Engine-only (offline generator); the play app never imports this (CLAUDE.md).
 */

import { applyRestingPlacement } from '@trainer/core';
import type { MoveQuery } from '../engine/client.js';
import { CORRECT_GAP_MARGIN } from './combo.js';
import type { ComboContext, ComboEngine, ScoredCombo } from './combo.js';

/** Tuning for the deeper-confirm gate (#53). */
export interface DeeperConfirmConfig {
  /** How many top eval-ranked combos to re-value with the deeper search. */
  topN: number;
  /** Playout count for the deeper search (`> 0` enables lookahead playouts). */
  playoutCount: number;
  /** Playout length for the deeper search. */
  playoutLength: number;
  /**
   * Deeper-value margin (in StackRabbit units) by which a different combo must
   * beat the eval-only pick to RE-RANK to it. Below this, the disagreement is
   * treated as noise and the eval-only pick stands.
   */
  rerankMargin: number;
  /**
   * Deeper-value margin beyond which the disagreement is a genuine eval-only
   * quirk and the whole puzzle is REJECTED rather than re-ranked. Must be larger
   * than {@link rerankMargin}.
   */
  rejectMargin: number;
  /**
   * Eval/deeper rank-1 **inversion** cull (#59, puzzle 436). Even when the deeper
   * search edges the eval-only pick by less than {@link rerankMargin} (normally
   * treated as noise), if eval-only ranked that deeper-best combo more than this
   * many eval units below its own #1 — far enough to grade it INCORRECT — the
   * eval scoring is miscalibrated for the position: a mirror near-tie the engine
   * broke the wrong way, where eval-only would fail the genuinely-best line.
   * Reject rather than bank a mis-grading optimal. Defaults to the grading
   * margin (`CORRECT_GAP_MARGIN`) so "the deeper-best is one eval grades wrong"
   * is exactly the trigger.
   */
  evalInversionGap: number;
}

export const DEFAULT_DEEPER_CONFIRM: DeeperConfirmConfig = {
  // Re-check the rank-1 plus a few close contenders — enough to catch a quirk
  // without paying the deeper search over the whole sweep.
  topN: 4,
  // A modest playout budget: deep enough to be lookahead-aware, cheap enough to
  // run on the top-N of every survivor.
  playoutCount: 32,
  playoutLength: 2,
  // Tuned against the same eval-unit scale as the combo sweep (#47): a few units
  // is real signal, a large gap means the eval-only pick was badly wrong.
  rerankMargin: 2,
  rejectMargin: 12,
  // The deeper-best must beat the grading bar in eval units: if eval-only scored
  // it as a miss yet the deeper search calls it best, the position is unbankable.
  evalInversionGap: CORRECT_GAP_MARGIN,
};

/** The verdict of {@link deeperConfirmBest}. */
export type DeeperDecision =
  | { kind: 'confirmed'; best: ScoredCombo }
  | { kind: 'reranked'; best: ScoredCombo }
  | { kind: 'reject'; reason: 'deeper-quirk' | 'eval-inversion' | 'deeper-no-combos' };

/**
 * Re-value the top-N eval-ranked combos with a deeper StackRabbit search and
 * decide whether the eval-only optimal is confirmed, should be re-ranked to a
 * deeper-confirmed best, or the puzzle should be rejected as an eval-only quirk.
 *
 * `ranked` is the dominance-respecting rank order from the sweep (best-first);
 * `ranked[0]` is the eval-only optimal. Each contender's resulting board
 * (`board2`) is re-rated at `config.playoutCount > 0`. If the deeper search
 * cannot value the eval-only pick (e.g. a degenerate playout), the pick is kept
 * rather than thrashing on a missing measurement.
 */
export async function deeperConfirmBest(
  engine: ComboEngine,
  ctx: ComboContext,
  ranked: readonly ScoredCombo[],
  timeline: string,
  config: DeeperConfirmConfig = DEFAULT_DEEPER_CONFIRM,
): Promise<DeeperDecision> {
  const evalBest = ranked[0];
  if (!evalBest) return { kind: 'reject', reason: 'deeper-no-combos' };

  const top = ranked.slice(0, Math.max(1, config.topN));
  const deep = new Map<ScoredCombo, number>();
  for (const combo of top) {
    const board1 = applyRestingPlacement(ctx.board, ctx.piece1, combo.p1);
    const query2: MoveQuery = {
      board: board1,
      currentPiece: ctx.piece2,
      nextPiece: null,
      level: ctx.level,
      lines: ctx.lines,
      inputFrameTimeline: timeline,
    };
    try {
      const { playerValue } = await engine.rateMove(query2, combo.board2, {
        playoutCount: config.playoutCount,
        playoutLength: config.playoutLength,
      });
      if (Number.isFinite(playerValue)) deep.set(combo, playerValue);
    } catch {
      // Unreachable / unvaluable under the deeper search — skip this contender.
    }
  }

  // Without a deeper value for the eval-only pick there is nothing to confirm
  // against; keep it rather than re-rank or reject on a missing measurement.
  if (!deep.has(evalBest)) return { kind: 'confirmed', best: evalBest };

  let deepBest = evalBest;
  for (const [combo, value] of deep) {
    if (value > (deep.get(deepBest) ?? Number.NEGATIVE_INFINITY)) deepBest = combo;
  }
  if (deepBest === evalBest) return { kind: 'confirmed', best: evalBest };

  const delta = (deep.get(deepBest) ?? 0) - (deep.get(evalBest) ?? 0);
  if (delta >= config.rejectMargin) return { kind: 'reject', reason: 'deeper-quirk' };
  if (delta >= config.rerankMargin) return { kind: 'reranked', best: deepBest };
  // Sub-rerankMargin disagreement: the deeper search edges a different combo by
  // only a hair — normally noise, keep the eval pick. But if eval-only had ranked
  // that deeper-best far enough down to grade it INCORRECT, the eval scoring is
  // miscalibrated for this position (a mirror near-tie broken the wrong way, #59
  // puzzle 436): banking it would fail the genuinely-best line. Reject.
  const evalGapOfDeepBest = evalBest.value - deepBest.value;
  if (evalGapOfDeepBest > config.evalInversionGap) {
    return { kind: 'reject', reason: 'eval-inversion' };
  }
  return { kind: 'confirmed', best: evalBest };
}
