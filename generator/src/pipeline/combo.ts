/**
 * Two-piece combo evaluation (#33) — the heart of the combo-grading overhaul.
 *
 * A puzzle is "find the best two-piece combo." Rather than scoring each ply in
 * isolation, the generator sweeps the FULL cross-product of legal placements —
 * every piece-1 placement × every piece-2 placement on the resulting board —
 * and values each combo by StackRabbit's evaluation of the board after BOTH
 * placements (the second move's `rate-move` value, which is a function of that
 * resulting board). The values are field-normalized to 0–100 across the puzzle
 * (best = 100, worst legal = 0) and the top-K are stored (docs/decisions.md,
 * 2026-06-20 "Combo-grading overhaul"; glossary *Two-piece combo*, *Combo
 * score*, *Combo table*, *Board-health floor*).
 *
 * Engine-only: this module runs in the offline generator and never ships to the
 * play app (CLAUDE.md guardrail). It reuses the typed engine client (#4).
 */

import { PIECES, applyPlacement, type Grid, type Piece } from '@trainer/core';
import type { ComboEntry, ComboTable } from '@trainer/data';
import type { EngineMove, MoveQuery, RateMoveResult } from '../engine/client.js';
import { enumerateLegalMoves } from '../selfplay/self-play.js';

/** The slice of the engine client combo evaluation needs. */
export interface ComboEngine {
  getBestMove(query: MoveQuery): Promise<EngineMove | null>;
  rateMove(query: MoveQuery, playerBoardAfter: Grid): Promise<RateMoveResult>;
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
 * One swept combo: both placements (in our (rotation, col) coordinates), the
 * raw engine value of the combo, and the board after both placements (kept so
 * the rank-1 combo's result metrics can be computed without re-applying).
 */
export interface ScoredCombo {
  rot1: number;
  col1: number;
  rot2: number;
  col2: number;
  /** Raw engine value (the second move's rate-move `playerValue`). */
  value: number;
  /** The board after both placements (line clears included). */
  board2: Grid;
}

/** True if two combos are the same pair of placements. */
export function combosEqual(
  a: { rot1: number; col1: number; rot2: number; col2: number },
  b: { rot1: number; col1: number; rot2: number; col2: number },
): boolean {
  return a.rot1 === b.rot1 && a.col1 === b.col1 && a.rot2 === b.rot2 && a.col2 === b.col2;
}

/**
 * The board-health floor signal (#33): the MINIMUM over the 7 piece types of
 * `getBestMove(board, piece).totalValue` — i.e. how good the board is to build
 * on for its *worst* possible next piece. Piece-independent on purpose, so an
 * awkward puzzle piece draw doesn't reject an otherwise good board. Returns
 * `-Infinity` if any piece has no legal move or no finite value (a board that
 * bad is below any sensible floor).
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
 * Sweep the full cross-product of legal two-piece combos on `ctx.board`, valuing
 * each by the second move's `rate-move` value at `timeline`. Combos the engine
 * cannot value (a placement unreachable under the timeline — `rate-move` reports
 * "player move not found") are skipped, exactly as the old value-table sweep
 * did. Returned best-first by value.
 */
export async function sweepCombos(
  engine: ComboEngine,
  ctx: ComboContext,
  timeline: string,
): Promise<ScoredCombo[]> {
  const { board, piece1, piece2, level, lines } = ctx;
  const combos: ScoredCombo[] = [];

  for (const p1 of enumerateLegalMoves(board, piece1)) {
    const board1 = applyPlacement(board, piece1, p1);
    const query2: MoveQuery = {
      board: board1,
      currentPiece: piece2,
      nextPiece: null,
      level,
      lines,
      inputFrameTimeline: timeline,
    };
    for (const p2 of enumerateLegalMoves(board1, piece2)) {
      const board2 = applyPlacement(board1, piece2, p2);
      let value: number;
      try {
        value = (await engine.rateMove(query2, board2)).playerValue;
      } catch {
        continue; // unreachable under this timeline — not a fair combo.
      }
      if (!Number.isFinite(value)) continue;
      combos.push({ rot1: p1.rotation, col1: p1.col, rot2: p2.rotation, col2: p2.col, value, board2 });
    }
  }

  combos.sort((a, b) => b.value - a.value);
  return combos;
}

/**
 * Re-value an existing set of combos at a different `timeline` and return them
 * best-first — used by the Hz-invariance gate to confirm the best combo does not
 * change between slow-tap and fast-DAS. Combos unreachable under the timeline
 * are dropped (so a best combo that cannot be executed fast correctly fails the
 * gate).
 */
export async function rerankAt(
  engine: ComboEngine,
  ctx: ComboContext,
  combos: readonly ScoredCombo[],
  timeline: string,
): Promise<ScoredCombo[]> {
  const { board, piece1, piece2, level, lines } = ctx;
  const reranked: ScoredCombo[] = [];

  for (const combo of combos) {
    const board1 = applyPlacement(board, piece1, { rotation: combo.rot1, col: combo.col1 });
    const query2: MoveQuery = {
      board: board1,
      currentPiece: piece2,
      nextPiece: null,
      level,
      lines,
      inputFrameTimeline: timeline,
    };
    let value: number;
    try {
      value = (await engine.rateMove(query2, combo.board2)).playerValue;
    } catch {
      continue;
    }
    if (!Number.isFinite(value)) continue;
    reranked.push({ ...combo, value });
  }

  reranked.sort((a, b) => b.value - a.value);
  return reranked;
}

/**
 * Field-normalize swept combos to a 0–100 score (best = 100, worst legal = 0)
 * and keep the top `topK`, best-first, alongside the total ranked count. When
 * every combo ties (or there is only one), all score 100. Scores are rounded to
 * whole numbers for a clean ranked list (the rank-1 combo is always exactly 100).
 */
export function normalizeCombos(combos: readonly ScoredCombo[], topK: number): ComboTable {
  if (combos.length === 0) return { entries: [], total: 0 };

  const values = combos.map((c) => c.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;

  const entries: ComboEntry[] = combos.slice(0, topK).map((c) => ({
    rot1: c.rot1,
    col1: c.col1,
    rot2: c.rot2,
    col2: c.col2,
    score: span === 0 ? 100 : Math.round(((c.value - min) / span) * 100),
  }));

  return { entries, total: combos.length };
}
