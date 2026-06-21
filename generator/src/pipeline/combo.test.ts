import { describe, it, expect } from 'vitest';
import { applyPlacement, emptyBoard, type Grid } from '@trainer/core';
import {
  boardHealth,
  combosEqual,
  normalizeCombos,
  sweepCombos,
  type ComboContext,
  type ComboEngine,
  type ScoredCombo,
} from './combo.js';
import type { EngineMove, MoveQuery, RateMoveResult } from '../engine/client.js';

const combo = (
  rot1: number,
  col1: number,
  rot2: number,
  col2: number,
  value: number,
): ScoredCombo => ({ rot1, col1, rot2, col2, value, board2: emptyBoard() });

describe('normalizeCombos (#33)', () => {
  it('field-normalizes to 0–100 (best = 100, worst = 0) and ranks descending', () => {
    const table = normalizeCombos(
      [combo(0, 0, 0, 0, 10), combo(0, 1, 0, 0, 5), combo(0, 2, 0, 0, 0)],
      30,
    );
    expect(table.total).toBe(3);
    expect(table.entries.map((e) => e.score)).toEqual([100, 50, 0]);
    expect(table.entries[0]).toMatchObject({ rot1: 0, col1: 0 });
  });

  it('keeps only the top-K but reports the full ranked total', () => {
    const combos = Array.from({ length: 40 }, (_, i) => combo(0, i % 10, 0, 0, 100 - i));
    const table = normalizeCombos(combos, 30);
    expect(table.entries).toHaveLength(30);
    expect(table.total).toBe(40);
    expect(table.entries[0].score).toBe(100);
  });

  it('scores every combo 100 when they all tie', () => {
    const table = normalizeCombos([combo(0, 0, 0, 0, 7), combo(0, 1, 0, 0, 7)], 30);
    expect(table.entries.every((e) => e.score === 100)).toBe(true);
    expect(table.total).toBe(2);
  });

  it('is empty for no combos', () => {
    expect(normalizeCombos([], 30)).toEqual({ entries: [], total: 0 });
  });
});

describe('combosEqual (#33)', () => {
  it('compares both placements', () => {
    expect(combosEqual(combo(0, 0, 1, 3, 0), combo(0, 0, 1, 3, 99))).toBe(true);
    expect(combosEqual(combo(0, 0, 1, 3, 0), combo(0, 0, 1, 4, 0))).toBe(false);
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

  it('is -Infinity when any piece has no legal move', async () => {
    const engine = healthEngine({ I: 30, O: 20, T: 25, S: null, Z: 15, J: 22, L: 18 });
    expect(await boardHealth(engine, emptyBoard(), 18, 0, 'X.....')).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('sweepCombos (#33)', () => {
  it('values every legal combo and returns them best-first', async () => {
    // rate-move value = aggregate height of the resulting board (so distinct
    // placements get distinct values); lower stacks score higher here only if we
    // negate — we keep raw and just assert the sweep covers all combos sorted.
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
    // O has 9 legal columns; O×O = 81 combos, all reachable on an empty board.
    expect(combos).toHaveLength(81);
    // Sorted best-first.
    for (let i = 1; i < combos.length; i++) {
      expect(combos[i - 1].value).toBeGreaterThanOrEqual(combos[i].value);
    }
  });
});
