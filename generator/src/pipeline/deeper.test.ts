import { describe, it, expect } from 'vitest';
import { emptyBoard, type Grid } from '@trainer/core';
import { deeperConfirmBest, DEFAULT_DEEPER_CONFIRM } from './deeper.js';
import type { ComboContext, ComboEngine, ScoredCombo } from './combo.js';
import type { MoveQuery, RateMoveOptions, RateMoveResult } from '../engine/client.js';

// --- Test doubles -----------------------------------------------------------

const ctx: ComboContext = {
  board: emptyBoard(),
  piece1: 'O',
  piece2: 'O',
  level: 18,
  lines: 0,
};

/** A scored combo with a distinct `board2` object used as the engine's lookup key. */
function combo(value: number, board2: Grid, key: string): ScoredCombo {
  return {
    p1: { rotation: 0, row: 18, col: 0 },
    p2: { rotation: 0, row: 16, col: 0 },
    value,
    board2,
    boardKey: key,
  };
}

/**
 * An engine whose DEEPER rating (playoutCount > 0) returns the value mapped to
 * the resulting board (matched by reference). Boards with no mapping return NaN,
 * standing in for a contender the deeper search cannot value.
 */
function deepEngine(deepValues: Map<Grid, number>): ComboEngine {
  return {
    async getBestMove(): Promise<null> {
      return null;
    },
    async rateMove(
      _query: MoveQuery,
      after: Grid,
      options?: RateMoveOptions,
    ): Promise<RateMoveResult> {
      expect(options?.playoutCount).toBeGreaterThan(0); // deeper-confirm always deepens
      const value = deepValues.get(after) ?? Number.NaN;
      return { playerValue: value, bestValue: 0 };
    },
  };
}

describe('deeperConfirmBest (#53)', () => {
  const a = combo(100, emptyBoard(), 'A');
  const b = combo(98, emptyBoard(), 'B');
  const c = combo(50, emptyBoard(), 'C');
  const ranked = [a, b, c];

  it('confirms the eval-only optimal when the deeper search agrees', async () => {
    const engine = deepEngine(
      new Map([
        [a.board2, 100],
        [b.board2, 90],
        [c.board2, 10],
      ]),
    );
    const decision = await deeperConfirmBest(engine, ctx, ranked, 'X.....');
    expect(decision.kind).toBe('confirmed');
    if (decision.kind !== 'reject') expect(decision.best).toBe(a);
  });

  it('re-ranks to the deeper-confirmed best when it wins by a margin', async () => {
    // B beats A by 4 deeper units: above rerankMargin (2), below rejectMargin (12).
    const engine = deepEngine(
      new Map([
        [a.board2, 100],
        [b.board2, 104],
        [c.board2, 10],
      ]),
    );
    const decision = await deeperConfirmBest(engine, ctx, ranked, 'X.....');
    expect(decision.kind).toBe('reranked');
    if (decision.kind !== 'reject') expect(decision.best).toBe(b);
  });

  it('rejects the puzzle when the deeper search contradicts the pick beyond the threshold', async () => {
    // B beats A by 20 deeper units: above rejectMargin (12) → eval-only quirk.
    const engine = deepEngine(
      new Map([
        [a.board2, 100],
        [b.board2, 120],
        [c.board2, 10],
      ]),
    );
    const decision = await deeperConfirmBest(engine, ctx, ranked, 'X.....');
    expect(decision.kind).toBe('reject');
    if (decision.kind === 'reject') expect(decision.reason).toBe('deeper-quirk');
  });

  it('treats a sub-margin disagreement as noise and keeps the eval-only pick', async () => {
    // B beats A by only 1 deeper unit: below rerankMargin → confirmed.
    const engine = deepEngine(
      new Map([
        [a.board2, 100],
        [b.board2, 101],
        [c.board2, 10],
      ]),
    );
    const decision = await deeperConfirmBest(engine, ctx, ranked, 'X.....');
    expect(decision.kind).toBe('confirmed');
    if (decision.kind !== 'reject') expect(decision.best).toBe(a);
  });

  it('keeps the eval-only pick when the deeper search cannot value it', async () => {
    // No deeper value for A (the eval-best) → nothing to confirm against; keep A.
    const engine = deepEngine(
      new Map([
        [b.board2, 120],
        [c.board2, 10],
      ]),
    );
    const decision = await deeperConfirmBest(engine, ctx, ranked, 'X.....');
    expect(decision.kind).toBe('confirmed');
    if (decision.kind !== 'reject') expect(decision.best).toBe(a);
  });

  it('only re-values the top-N contenders (bounded cost)', async () => {
    const seen: Grid[] = [];
    const wide = Array.from({ length: 10 }, (_, i) => combo(100 - i, emptyBoard(), `K${i}`));
    const engine: ComboEngine = {
      async getBestMove() {
        return null;
      },
      async rateMove(_q, after) {
        seen.push(after);
        return { playerValue: 0, bestValue: 0 };
      },
    };
    await deeperConfirmBest(engine, ctx, wide, 'X.....', {
      ...DEFAULT_DEEPER_CONFIRM,
      topN: 3,
    });
    expect(seen).toHaveLength(3);
  });
});
