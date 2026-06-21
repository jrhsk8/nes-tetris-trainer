import { describe, it, expect } from 'vitest';
import { applyPlacement, emptyBoard, ROWS, COLS, type Grid } from '@trainer/core';
import {
  SelfPlayBoardSource,
  enumerateLegalMoves,
  gridsEqual,
  toHardDropPlacement,
  type MoveEngine,
} from './self-play.js';
import { StackRabbitClient } from '../engine/client.js';
import { DEFAULT_BASE_URL } from '../engine/client.js';

/** A small seeded PRNG (mulberry32) so "random" self-play is reproducible in tests. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An engine that must never be consulted (used to prove the all-random path). */
const forbiddenEngine: MoveEngine = {
  getBestMove() {
    throw new Error('engine should not be called when noiseRate = 1');
  },
};

const isValidGrid = (g: Grid) =>
  g.length === ROWS &&
  g.every((row) => row.length === COLS && row.every((c) => c === 0 || c === 1));
const filledCells = (g: Grid) => g.flat().filter((c) => c).length;

describe('enumerateLegalMoves', () => {
  it('lists every in-bounds placement and only legal ones', () => {
    const board = emptyBoard();
    // O has one rotation, width 2 → columns 0..8 (9 placements).
    expect(enumerateLegalMoves(board, 'O')).toHaveLength(9);
    // I has two rotations: horizontal (width 4 → 7) + vertical (width 1 → 10).
    expect(enumerateLegalMoves(board, 'I')).toHaveLength(17);
  });

  it('returns nothing for a piece with no room on a full board', () => {
    const full: Grid = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(1));
    expect(enumerateLegalMoves(full, 'T')).toHaveLength(0);
  });
});

describe('gridsEqual', () => {
  it('is true for identical grids and false otherwise', () => {
    const a = emptyBoard();
    const b = emptyBoard();
    expect(gridsEqual(a, b)).toBe(true);
    b[0][0] = 1;
    expect(gridsEqual(a, b)).toBe(false);
  });
});

describe('toHardDropPlacement (recover our placement from the engine result)', () => {
  it('recovers the (rotation, col) that produced a result board', () => {
    const before = emptyBoard();
    const placement = { rotation: 0, col: 4 };
    const after = applyPlacement(before, 'T', placement);
    expect(toHardDropPlacement(before, 'T', after)).toEqual(placement);
  });

  it('recovers a placement even when it clears a line', () => {
    const before = emptyBoard();
    for (let col = 0; col < 8; col++) before[ROWS - 1][col] = 1;
    const placement = { rotation: 0, col: 8 };
    const after = applyPlacement(before, 'O', placement);
    expect(toHardDropPlacement(before, 'O', after)).toEqual(placement);
  });

  it('returns null when no single placement reproduces the board', () => {
    const before = emptyBoard();
    const bogus: Grid = emptyBoard();
    bogus[0][0] = 1; // a lone floating cell no dropped piece could create
    expect(toHardDropPlacement(before, 'T', bogus)).toBeNull();
  });
});

describe('SelfPlayBoardSource (deterministic, all-random policy)', () => {
  const config = { noiseRate: 1, minDepth: 8, maxDepth: 8 } as const;

  it('produces a valid, non-empty, reachable mid-game candidate without the engine', async () => {
    const source = new SelfPlayBoardSource(forbiddenEngine, seededRng(42), config);
    const candidate = await source.next();

    expect(isValidGrid(candidate.board)).toBe(true);
    expect(filledCells(candidate.board)).toBeGreaterThan(0);
    // Eight single-tetromino placements, minus any cleared lines, can never
    // exceed the cells eight pieces add.
    expect(filledCells(candidate.board)).toBeLessThanOrEqual(8 * 4);
    expect(['I', 'O', 'T', 'S', 'Z', 'J', 'L']).toContain(candidate.currentPiece);
    expect(['I', 'O', 'T', 'S', 'Z', 'J', 'L']).toContain(candidate.nextPiece);
    expect(candidate.level).toBe(18);
  });

  it('is reproducible for a given seed and varies across seeds', async () => {
    const a = await new SelfPlayBoardSource(forbiddenEngine, seededRng(7), config).next();
    const b = await new SelfPlayBoardSource(forbiddenEngine, seededRng(7), config).next();
    const c = await new SelfPlayBoardSource(forbiddenEngine, seededRng(99), config).next();

    expect(a.board).toEqual(b.board);
    expect(a.board).not.toEqual(c.board);
  });
});

// Integration smoke test — self-play driving the real engine. Skipped cleanly
// when no engine is reachable.
const baseUrl = process.env.STACKRABBIT_URL ?? DEFAULT_BASE_URL;
const engineUp = await new StackRabbitClient({ baseUrl }).ping();

describe.skipIf(!engineUp)('SelfPlayBoardSource (live engine)', () => {
  it('generates a varied, reachable mid-game board via the BoardSource interface', async () => {
    const source = new SelfPlayBoardSource(new StackRabbitClient({ baseUrl }), seededRng(123), {
      minDepth: 8,
      maxDepth: 10,
      noiseRate: 0.2,
    });

    const candidate = await source.next();
    expect(isValidGrid(candidate.board)).toBe(true);
    expect(filledCells(candidate.board)).toBeGreaterThan(0);
    // A mid-game snapshot should leave the top of the board clear, not topped out.
    expect(candidate.board[0].every((c) => c === 0)).toBe(true);
  });
});
