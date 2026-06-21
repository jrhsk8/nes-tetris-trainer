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
  isReachablePlacement,
  normalizeCombos,
  normalizedScores,
  sweepCombos,
  type ComboContext,
  type ComboEngine,
  type ScoredCombo,
} from './combo.js';
import type { EngineMove, MoveQuery, RateMoveResult } from '../engine/client.js';

/** A scored combo at the given resting columns (row inferred is irrelevant here). */
const combo = (col1: number, col2: number, value: number, key: string): ScoredCombo => ({
  p1: { rotation: 0, row: 18, col: col1 },
  p2: { rotation: 0, row: 18, col: col2 },
  value,
  board2: emptyBoard(),
  boardKey: key,
});

describe('normalizedScores / normalizeCombos (#40)', () => {
  it('field-normalizes to 0–100 (best = 100, worst = 0) and ranks descending', () => {
    const combos = [combo(0, 0, 10, 'a'), combo(1, 0, 5, 'b'), combo(2, 0, 0, 'c')];
    expect(normalizedScores(combos)).toEqual([100, 50, 0]);
    const table = normalizeCombos(combos, 30);
    expect(table.total).toBe(3);
    expect(table.entries.map((e) => e.score)).toEqual([100, 50, 0]);
    expect(table.entries[0]).toMatchObject({ rot1: 0, col1: 0, boardKey: 'a' });
  });

  it('keeps only the top-K but reports the full ranked total, each with a boardKey', () => {
    const combos = Array.from({ length: 40 }, (_, i) => combo(i % 10, 0, 100 - i, `k${i}`));
    const table = normalizeCombos(combos, 30);
    expect(table.entries).toHaveLength(30);
    expect(table.total).toBe(40);
    expect(table.entries[0].score).toBe(100);
    expect(table.entries.every((e) => typeof e.boardKey === 'string')).toBe(true);
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
