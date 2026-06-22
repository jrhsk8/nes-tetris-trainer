import { describe, it, expect } from 'vitest';
import {
  applyPlacement,
  applyRestingPlacement,
  boardKey,
  emptyBoard,
  type Grid,
} from '@trainer/core';
import {
  boardHealth,
  comboCleanliness,
  isReachablePlacement,
  normalizeCombos,
  normalizedScores,
  rank1QualityReason,
  rankCombosBySanity,
  sweepCombos,
  CORRECT_GAP_MARGIN,
  type ComboContext,
  type ComboEngine,
  type ScoredCombo,
} from './combo.js';
import { CORRECT_SCORE_THRESHOLD } from '@trainer/core';
import type { EngineMove, MoveQuery, RateMoveResult } from '../engine/client.js';

/** A scored combo at the given resting columns (row inferred is irrelevant here). */
const combo = (col1: number, col2: number, value: number, key: string): ScoredCombo => ({
  p1: { rotation: 0, row: 18, col: col1 },
  p2: { rotation: 0, row: 18, col: col2 },
  value,
  board2: emptyBoard(),
  boardKey: key,
});

describe('normalizedScores / normalizeCombos — gap-from-best (#47)', () => {
  it('anchors to gap from the best (rank-1 = 100), not the worst legal, as floats (#60)', () => {
    // best = 10; gaps 0 / 5 / 10 → 100 / 100−0.625·5 / 100−0.625·10 (no rounding).
    const combos = [combo(0, 0, 10, 'a'), combo(1, 0, 5, 'b'), combo(2, 0, 0, 'c')];
    expect(normalizedScores(combos)).toEqual([100, 96.875, 93.75]);
    const table = normalizeCombos(combos, 30);
    expect(table.total).toBe(3);
    expect(table.entries.map((e) => e.score)).toEqual([100, 96.875, 93.75]);
    expect(table.entries[0]).toMatchObject({ rot1: 0, col1: 0, boardKey: 'a' });
  });

  it('grades the gap=MARGIN boundary correct and just past it incorrect (#60: 97/4.8)', () => {
    // The win line is now 97 ⇔ gap ≤ CORRECT_GAP_MARGIN (4.8) at the pinned k=0.625.
    const atMargin = normalizedScores([combo(0, 0, 100, 'a'), combo(1, 0, 100 - CORRECT_GAP_MARGIN, 'b')]);
    expect(atMargin[1]).toBe(CORRECT_SCORE_THRESHOLD); // exactly 97 — still correct
    const pastMargin = normalizedScores([combo(0, 0, 100, 'a'), combo(1, 0, 100 - CORRECT_GAP_MARGIN - 0.1, 'b')]);
    expect(pastMargin[1]).toBeLessThan(CORRECT_SCORE_THRESHOLD); // ranked, shown, but incorrect
  });

  it('grades a move the OLD min-max scheme passed (≥95) as incorrect', () => {
    // values 1000 / 980 / 0: old min-max gave the middle (980−0)/1000·100 = 98
    // (correct). Gap-from-best is 20 → 100−0.625·20 = 87.5 (incorrect, well below 97).
    const scores = normalizedScores([combo(0, 0, 1000, 'a'), combo(1, 0, 980, 'b'), combo(2, 0, 0, 'c')]);
    expect(scores[1]).toBe(87.5);
    expect(scores[1]).toBeLessThan(CORRECT_SCORE_THRESHOLD);
  });

  it('gives the same score for the same absolute gap across puzzles with different worst-legal tails', () => {
    // Both have a rank-2 gap of 8, but wildly different worst-legal anchors.
    const tight = normalizedScores([combo(0, 0, 50, 'a'), combo(1, 0, 42, 'b')]);
    const wide = normalizedScores([combo(0, 0, 1000, 'a'), combo(1, 0, 992, 'b'), combo(2, 0, -500, 'c')]);
    expect(tight[1]).toBe(95);
    expect(wide[1]).toBe(95); // identical despite a far worse tail
  });

  it('keeps only the top-K but reports the full ranked total, each with a boardKey', () => {
    const combos = Array.from({ length: 40 }, (_, i) => combo(i % 10, 0, 100 - i, `k${i}`));
    const table = normalizeCombos(combos, 30);
    expect(table.entries).toHaveLength(30);
    expect(table.total).toBe(40);
    expect(table.entries[0].score).toBe(100);
    expect(table.entries.every((e) => typeof e.boardKey === 'string')).toBe(true);
  });

  it('keeps rank-1 at 100 when the sanity re-rank seats a lower-value combo first (#50/#60)', () => {
    // Post-#50 order can place a cleaner, slightly-lower-value combo at rank-1
    // above a higher-value one. The score anchors on rank-1 (combos[0]), so it
    // stays exactly 100 and the demoted higher-value combo clamps to 100 — never
    // a rank-1 below 100 (the latent <100 bug the live-bank smoke test exposed).
    const ordered = [combo(0, 0, 98, 'clean-rank1'), combo(1, 0, 100, 'demoted-higher-value')];
    const scores = normalizedScores(ordered);
    expect(scores[0]).toBe(100);
    const table = normalizeCombos(ordered, 30);
    expect(table.entries[0].score).toBe(100);
    expect(table.entries[1].score).toBe(100); // higher value clamps to 100, non-increasing
  });

  it('scores every combo 100 when they all tie', () => {
    const table = normalizeCombos([combo(0, 0, 7, 'a'), combo(1, 0, 7, 'b')], 30);
    expect(table.entries.every((e) => e.score === 100)).toBe(true);
    expect(table.total).toBe(2);
  });

  it('is empty for no combos', () => {
    expect(normalizeCombos([], 30)).toEqual({ entries: [], total: 0 });
    expect(normalizedScores([])).toEqual([]);
  });
});

/** A fake engine whose per-piece best-move value comes from `values`. */
function healthEngine(values: Partial<Record<string, number | null>>): ComboEngine {
  return {
    async getBestMove(query: MoveQuery): Promise<EngineMove | null> {
      const v = values[query.currentPiece];
      if (v === null || v === undefined) return null;
      return {
        rotation: 0,
        x: 0,
        y: 0,
        board: applyPlacement(query.board, query.currentPiece, { rotation: 0, col: 0 }),
        totalValue: v,
      };
    },
    async rateMove(): Promise<RateMoveResult> {
      return { playerValue: 0, bestValue: 0 };
    },
  };
}

describe('boardHealth (#33)', () => {
  it('returns the minimum best-move value across the 7 piece types', async () => {
    const engine = healthEngine({ I: 30, O: 20, T: 25, S: 10, Z: 15, J: 22, L: 18 });
    expect(await boardHealth(engine, emptyBoard(), 18, 0, 'X.....')).toBe(10);
  });

  it('is -Infinity when any piece has no legal move (the fairness floor)', async () => {
    const engine = healthEngine({ I: 30, O: 20, T: 25, S: null, Z: 15, J: 22, L: 18 });
    expect(await boardHealth(engine, emptyBoard(), 18, 0, 'X.....')).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('sweepCombos (#40)', () => {
  it('values every legal combo, keys by outcome, and returns them best-first', async () => {
    const engine: ComboEngine = {
      async getBestMove() {
        return null; // unused by sweepCombos
      },
      async rateMove(_query: MoveQuery, after: Grid): Promise<RateMoveResult> {
        const filled = after.flat().filter(Boolean).length;
        return { playerValue: filled, bestValue: 0 };
      },
    };
    const ctx: ComboContext = {
      board: emptyBoard(),
      piece1: 'O',
      piece2: 'O',
      level: 18,
      lines: 0,
    };
    const combos = await sweepCombos(engine, ctx, 'X.....');
    // O has 9 columns; O×O has 81 ordered placements, but combos that land the
    // same cells collapse by boardKey, so there are fewer distinct outcomes.
    expect(combos.length).toBeGreaterThan(0);
    expect(combos.length).toBeLessThanOrEqual(81);
    // Distinct outcome keys, sorted best-first.
    const keys = new Set(combos.map((c) => c.boardKey));
    expect(keys.size).toBe(combos.length);
    for (let i = 1; i < combos.length; i++) {
      expect(combos[i - 1].value).toBeGreaterThanOrEqual(combos[i].value);
    }
    // Every combo's boardKey matches its stored board2.
    for (const c of combos) expect(c.boardKey).toBe(boardKey(c.board2));
  });

  it('values a TUCK combo and can rank it #1 (engine prefers low resulting stacks)', async () => {
    // A ledge across cols 4..7 at row 10; the space beneath is reachable only by
    // a tuck (drop down open col 3, slide right). An engine that rewards lower
    // resulting stacks values the under-ledge tuck above stacking on the ledge.
    const board = emptyBoard();
    for (let c = 4; c <= 7; c++) board[10][c] = 1;

    const engine: ComboEngine = {
      async getBestMove() {
        return null;
      },
      async rateMove(_q: MoveQuery, after: Grid): Promise<RateMoveResult> {
        // Reward filling the pocket UNDER the ledge (col 4, rows 11..19) — only a
        // tuck can put cells there; a straight drop lands on top of the ledge.
        let v = 0;
        for (let r = 11; r < after.length; r++) if (after[r][4]) v++;
        return { playerValue: v, bestValue: 0 };
      },
    };
    const ctx: ComboContext = { board, piece1: 'I', piece2: 'O', level: 18, lines: 0 };
    const combos = await sweepCombos(engine, ctx, 'X.....');
    expect(combos.length).toBeGreaterThan(0);

    // The rank-1 combo places the vertical I as a tuck under the ledge (col 4,
    // resting at the floor — row 16), not on top of it.
    const best = combos[0];
    expect(best.p1).toMatchObject({ rotation: 1, col: 4, row: 16 });
    // It is genuinely reachable (the narrowed-Hz guard).
    expect(isReachablePlacement(board, 'I', best.p1)).toBe(true);
  });
});

/**
 * A board whose column 0 has the given `maxHeight` (its topmost cell at the
 * matching row) and exactly `holeCount` covered holes beneath it. Lets a test
 * dial in a combo's resulting-board cleanliness independent of engine value.
 */
function cleanlinessBoard(maxHeight: number, holeCount: number): Grid {
  const board = emptyBoard();
  for (let r = 20 - maxHeight; r < 20; r++) board[r][0] = 1; // solid column, 0 holes
  // Carve holes from the floor up; the topmost cell stays filled (covers them).
  let carved = 0;
  for (let r = 19; r > 20 - maxHeight && carved < holeCount; r--, carved++) board[r][0] = 0;
  return board;
}

const sanityCombo = (value: number, maxHeight: number, holeCount: number, key: string): ScoredCombo => ({
  p1: { rotation: 0, row: 18, col: 0 },
  p2: { rotation: 0, row: 18, col: 1 },
  value,
  board2: cleanlinessBoard(maxHeight, holeCount),
  boardKey: key,
});

describe('combo cleanliness (#50)', () => {
  it('reports holes and tallest column of a combo board', () => {
    expect(comboCleanliness(sanityCombo(0, 6, 2, 'a'))).toEqual({ holes: 2, maxHeight: 6 });
  });
});

describe('rankCombosBySanity (#50 value-sanity invariant)', () => {
  it('never ranks a strictly more holey AND no-shorter board above a cleaner one', () => {
    // A: the engine's value-best, but tall and holey. B: cleaner (fewer holes,
    // no taller), lower value — must be ranked above A despite the lower value.
    const a = sanityCombo(100, 13, 5, 'a');
    const b = sanityCombo(50, 13, 0, 'b');
    const ranked = rankCombosBySanity([a, b]);
    expect(ranked[0]).toBe(b);
    expect(ranked[1]).toBe(a);
  });

  it('preserves engine value order when no board is strictly holier-and-taller', () => {
    // A height-6 board ranked above a flatter height-4 board: equal holes, so the
    // engine's value order (its shape judgement) is trusted, not overridden.
    const hi = sanityCombo(100, 6, 0, 'hi');
    const lo = sanityCombo(40, 4, 0, 'lo');
    expect(rankCombosBySanity([lo, hi])).toEqual([hi, lo]);
    // Shorter-but-holier vs taller-but-cleaner are incomparable → value order.
    const a = sanityCombo(100, 6, 0, 'a');
    const b = sanityCombo(40, 4, 2, 'b');
    expect(rankCombosBySanity([b, a])).toEqual([a, b]);
  });
});

describe('rank1QualityReason (#50 outcome-quality gate)', () => {
  it('rejects a rank-1 board that buries holes a no-taller alternative avoids', () => {
    const best = sanityCombo(100, 8, 5, 'best');
    const cleaner = sanityCombo(50, 8, 0, 'clean');
    expect(rank1QualityReason(best, [best, cleaner])).toBe('rank1-holey');
  });

  it('rejects a needless tower when a materially shorter alternative exists', () => {
    const tower = sanityCombo(100, 12, 0, 'tower');
    const shorter = sanityCombo(50, 4, 2, 'short');
    expect(rank1QualityReason(tower, [tower, shorter])).toBe('rank1-tower');
  });

  it('does NOT reject a mild height difference (engine shape judgement trusted)', () => {
    // rank-1 leaves a height-4 board; a height-2 alternative exists. This is the
    // common, legitimate case — not an egregious tower or holey optimal.
    const best = sanityCombo(100, 4, 0, 'best');
    const flatter = sanityCombo(50, 2, 0, 'flat');
    expect(rank1QualityReason(best, [best, flatter])).toBeNull();
  });

  it('passes a clean, non-holey, non-tower rank-1', () => {
    const best = sanityCombo(100, 5, 0, 'best');
    const worse = sanityCombo(40, 8, 1, 'worse');
    expect(rank1QualityReason(best, [best, worse])).toBeNull();
  });
});

describe('isReachablePlacement (#40 narrowed-Hz guard)', () => {
  it('accepts a reachable resting placement and rejects a floating one', () => {
    const board = emptyBoard();
    expect(isReachablePlacement(board, 'O', { rotation: 0, row: 18, col: 0 })).toBe(true);
    expect(isReachablePlacement(board, 'O', { rotation: 0, row: 0, col: 0 })).toBe(false);
  });

  it('confirms a tuck resting placement under an overhang is reachable', () => {
    const board = emptyBoard();
    for (let c = 4; c <= 7; c++) board[10][c] = 1;
    expect(isReachablePlacement(board, 'I', { rotation: 1, row: 16, col: 4 })).toBe(true);
    // applying it lands the cells we expect.
    const after = applyRestingPlacement(board, 'I', { rotation: 1, row: 16, col: 4 });
    expect(after[19][4]).toBe(1);
  });
});
