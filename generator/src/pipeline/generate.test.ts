import { describe, it, expect } from 'vitest';
import {
  applyPlacement,
  boardMetrics,
  emptyBoard,
  emptyColorGrid,
  encodeBoard,
  isPiece,
} from '@trainer/core';
import type { NewPuzzle, Puzzle } from '@trainer/data';
import { assemblePuzzle, generateBank, type GeneratorEngine } from './generate.js';
import type { BoardSource, Candidate } from '../selfplay/board-source.js';
import type { EngineMove, MoveQuery, RateMoveResult, ScoredMove } from '../engine/client.js';
import { StackRabbitClient } from '../engine/client.js';
import { DEFAULT_BASE_URL } from '../engine/client.js';
import { SelfPlayBoardSource } from '../selfplay/self-play.js';

// --- Deterministic test doubles (no engine) ---------------------------------

/** A source that replays a fixed list of candidates then signals exhaustion. */
class FixedSource implements BoardSource {
  private i = 0;
  constructor(private readonly candidates: Candidate[]) {}
  async next(): Promise<Candidate | null> {
    return this.i < this.candidates.length ? this.candidates[this.i++] : null;
  }
}

/**
 * An engine that always drops the piece flat at column 0, identically across
 * timelines (so the Hz gate passes), and reports a configurable top-two margin.
 */
function flatDropEngine(margin: number): GeneratorEngine {
  const drop = (query: MoveQuery): EngineMove => ({
    rotation: 0,
    x: 0,
    y: 0,
    board: applyPlacement(query.board, query.currentPiece, { rotation: 0, col: 0 }),
    totalValue: 100,
  });
  return {
    async getBestMove(query) {
      return drop(query);
    },
    async getTopMoves(): Promise<ScoredMove[]> {
      return [
        { rotation: 0, x: 0, y: 0, totalValue: 100 },
        { rotation: 0, x: 1, y: 0, totalValue: 100 - margin },
      ];
    },
    async rateMove(): Promise<RateMoveResult> {
      // A flat, deterministic value is enough for the value-table assertions.
      return { playerValue: 42, bestValue: 50 };
    },
  };
}

/** A db double that records inserts and returns them as if stored. */
function recordingDb() {
  const stored: NewPuzzle[] = [];
  const order: string[] = [];
  const db = {
    async insertPuzzles(puzzles: NewPuzzle[]): Promise<Puzzle[]> {
      order.push('insert');
      stored.push(...puzzles);
      return puzzles.map((p, i) => ({
        id: `id-${i}`,
        ...p,
        glicko: { rating: 1500, deviation: 350, volatility: 0.06 },
        colors: p.colors ?? '',
        firstValues: p.firstValues ?? [],
        secondValues: p.secondValues ?? [],
      }));
    },
    async deleteAllPuzzles(): Promise<number> {
      order.push('delete');
      return 99;
    },
  };
  return { db, stored, order };
}

const sampleCandidate = (): Candidate => ({
  board: emptyBoard(),
  colors: emptyColorGrid(),
  currentPiece: 'O',
  nextPiece: 'T',
  level: 18,
  lines: 0,
});

const config = { unambiguityThreshold: 8, slowTimeline: 'X.....', fastTimeline: 'X.' };

describe('assemblePuzzle (deterministic)', () => {
  it('assembles a complete puzzle with the optimal line and result metrics', async () => {
    const candidate = sampleCandidate();
    const result = await assemblePuzzle(flatDropEngine(50), candidate, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const puzzle = result.puzzle;

    expect(puzzle.board).toBe(encodeBoard(candidate.board));
    expect(puzzle.piece1).toBe('O');
    expect(puzzle.piece2).toBe('T');
    expect(puzzle.optimalLine).toHaveLength(2);
    // Both plies were the flat column-0 drop the fake engine returns.
    expect(puzzle.optimalLine[0]).toEqual({ rotation: 0, col: 0 });

    // Optimal metrics are those of the board after both optimal placements.
    const board1 = applyPlacement(candidate.board, 'O', { rotation: 0, col: 0 });
    const board2 = applyPlacement(board1, 'T', { rotation: 0, col: 0 });
    expect(puzzle.optimalMetrics).toEqual(boardMetrics(board2));

    // The colour grid and value tables (#27) are populated. An empty-board O
    // has 9 legal placements; the optimal first move is included.
    expect(puzzle.colors).toHaveLength(200);
    expect(puzzle.firstValues).toHaveLength(9);
    expect(puzzle.firstValues).toContainEqual({ rotation: 0, col: 0, value: 42 });
    expect(puzzle.secondValues!.length).toBeGreaterThan(0);
  });

  it('skips placements the engine cannot value, without aborting the table', async () => {
    // An engine like flatDropEngine, but whose rate-move throws on its 2nd call
    // (as the real engine does for an unreachable "player move not found").
    let calls = 0;
    const base = flatDropEngine(50);
    const flaky: GeneratorEngine = {
      ...base,
      async rateMove(query, after) {
        calls++;
        if (calls === 2) throw new Error('rate-move failed: Error: player move not found');
        return base.rateMove(query, after);
      },
    };

    const result = await assemblePuzzle(flaky, sampleCandidate(), config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One of the nine O placements was unratable and dropped from the table.
    expect(result.puzzle.firstValues).toHaveLength(8);
  });

  it('rejects a candidate whose first ply is ambiguous (margin below threshold)', async () => {
    const result = await assemblePuzzle(flatDropEngine(3), sampleCandidate(), config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ply1-ambiguous');
  });
});

describe('generateBank (deterministic)', () => {
  it('stores only surviving puzzles and reports rejections', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        source: new FixedSource([sampleCandidate(), sampleCandidate(), sampleCandidate()]),
        engine: flatDropEngine(50),
        db,
      },
      { targetCount: 2, maxCandidates: 10, config },
    );

    expect(result.stored).toHaveLength(2);
    expect(stored).toHaveLength(2); // stopped at targetCount, did not try the third
    expect(result.candidatesTried).toBe(2);
  });

  it('replaces the bank: deletes existing puzzles after assembling survivors, then inserts', async () => {
    const { db, stored, order } = recordingDb();
    const result = await generateBank(
      {
        source: new FixedSource([sampleCandidate(), sampleCandidate()]),
        engine: flatDropEngine(50),
        db,
      },
      { targetCount: 2, maxCandidates: 10, replace: true, config },
    );

    expect(result.stored).toHaveLength(2);
    expect(stored).toHaveLength(2);
    // The delete happens only once survivors are ready, immediately before the
    // insert — minimising the window where the bank is empty.
    expect(order).toEqual(['delete', 'insert']);
  });

  it('records the rejection reason when nothing survives', async () => {
    const { db } = recordingDb();
    const result = await generateBank(
      { source: new FixedSource([sampleCandidate()]), engine: flatDropEngine(1), db },
      { targetCount: 5, maxCandidates: 10, config },
    );
    expect(result.stored).toHaveLength(0);
    expect(result.rejections['ply1-ambiguous']).toBe(1);
  });
});

// --- Live integration smoke test (real engine, in-memory db) ----------------
const baseUrl = process.env.STACKRABBIT_URL ?? DEFAULT_BASE_URL;
const engineUp = await new StackRabbitClient({ baseUrl }).ping();

describe.skipIf(!engineUp)('generateBank (live engine)', () => {
  it('produces a small bank of well-formed stored puzzles', async () => {
    const engine = new StackRabbitClient({ baseUrl });
    const source = new SelfPlayBoardSource(engine, Math.random, {
      minDepth: 6,
      maxDepth: 14,
      noiseRate: 0.35,
    });
    const { db, stored } = recordingDb();

    const result = await generateBank(
      { source, engine, db },
      { targetCount: 2, maxCandidates: 60 },
    );

    expect(result.stored.length).toBeGreaterThan(0);
    for (const puzzle of stored) {
      expect(puzzle.board).toHaveLength(200);
      expect(isPiece(puzzle.piece1)).toBe(true);
      expect(isPiece(puzzle.piece2)).toBe(true);
      expect(puzzle.optimalLine).toHaveLength(2);
      expect(puzzle.optimalMetrics.holes).toBeGreaterThanOrEqual(0);
      // The colour grid and value tables are present and well-formed (#27).
      expect(puzzle.colors).toHaveLength(200);
      expect(/^[0-3]{200}$/.test(puzzle.colors!)).toBe(true);
      expect(puzzle.firstValues!.length).toBeGreaterThan(0);
      expect(puzzle.secondValues!.length).toBeGreaterThan(0);
      // The optimal first move appears in the piece-1 value table.
      expect(
        puzzle.firstValues!.some(
          (v) => v.rotation === puzzle.optimalLine[0].rotation && v.col === puzzle.optimalLine[0].col,
        ),
      ).toBe(true);
    }
  }, 120_000);
});
