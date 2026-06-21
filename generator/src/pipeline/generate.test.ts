import { describe, it, expect } from 'vitest';
import { applyPlacement, emptyBoard, emptyColorGrid, encodeBoard, isPiece, type Grid } from '@trainer/core';
import type { NewPuzzle, Puzzle } from '@trainer/data';
import {
  assemblePuzzle,
  generateBank,
  DEFAULT_GENERATION_CONFIG,
  type GeneratorEngine,
} from './generate.js';
import type { BoardSource, Candidate } from '../selfplay/board-source.js';
import type { EngineMove, MoveQuery, RateMoveResult } from '../engine/client.js';
import { StackRabbitClient, DEFAULT_BASE_URL } from '../engine/client.js';
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
 * A controllable fake engine for the combo pipeline (#33):
 *  - `getBestMove` reports a constant board-health `totalValue` for every piece.
 *  - `rateMove` assigns combo values from a per-timeline counter: descending at
 *    the slow timeline (so the FIRST swept combo ranks #1), and — unless
 *    `speedVariant` — descending again at the fast timeline (so the best combo
 *    is the same at both speeds). With `speedVariant` the fast counter ascends,
 *    so the best combo flips and the Hz gate must reject.
 */
function comboEngine(opts: { health?: number; speedVariant?: boolean } = {}): GeneratorEngine {
  let slow = 1_000_000;
  let fast = opts.speedVariant ? 0 : 1_000_000;
  return {
    async getBestMove(query: MoveQuery): Promise<EngineMove | null> {
      return {
        rotation: 0,
        x: 0,
        y: 0,
        board: applyPlacement(query.board, query.currentPiece, { rotation: 0, col: 0 }),
        totalValue: opts.health ?? 100,
      };
    },
    async rateMove(query: MoveQuery): Promise<RateMoveResult> {
      const isFast = query.inputFrameTimeline === DEFAULT_GENERATION_CONFIG.fastTimeline;
      const value = isFast ? (opts.speedVariant ? fast++ : fast--) : slow--;
      return { playerValue: value, bestValue: 0 };
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
        combos: p.combos ?? { entries: [], total: 0 },
        firstValues: [],
        secondValues: [],
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
  nextPiece: 'O',
  level: 18,
  lines: 0,
});

/** A candidate whose board has many holes (fails the geometric pre-filter). */
function holeyCandidate(): Candidate {
  const board: Grid = emptyBoard();
  for (let i = 0; i < 10; i++) {
    const row = 19 - i;
    board[row][0] = 1; // filled cell...
    if (row + 1 < 20) board[row + 1][0] = 0; // ...with gaps below → holes
    board[row][2] = 1;
  }
  return { ...sampleCandidate(), board };
}

describe('assemblePuzzle combo pipeline (#33)', () => {
  it('stores a normalized top-K combo table with the rank-1 combo as the optimal line', async () => {
    const result = await assemblePuzzle(comboEngine(), sampleCandidate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const puzzle = result.puzzle;

    expect(puzzle.board).toBe(encodeBoard(emptyBoard()));
    expect(puzzle.piece1).toBe('O');
    expect(puzzle.piece2).toBe('O');

    // O×O on an empty board = 81 ranked combos; the top-30 are stored.
    expect(puzzle.combos!.total).toBe(81);
    expect(puzzle.combos!.entries).toHaveLength(30);
    // Sorted descending; the rank-1 combo scores exactly 100.
    expect(puzzle.combos!.entries[0].score).toBe(100);
    for (let i = 1; i < puzzle.combos!.entries.length; i++) {
      expect(puzzle.combos!.entries[i - 1].score).toBeGreaterThanOrEqual(
        puzzle.combos!.entries[i].score,
      );
    }

    // The optimal line is the rank-1 combo (first legal O placement, twice).
    expect(puzzle.optimalLine).toEqual([
      { rotation: 0, col: 0 },
      { rotation: 0, col: 0 },
    ]);
    // Colour grid still populated; no value tables.
    expect(puzzle.colors).toHaveLength(200);
    expect(puzzle.firstValues).toBeUndefined();
  });

  it('rejects a candidate below the board-health floor', async () => {
    const result = await assemblePuzzle(comboEngine({ health: -5 }), sampleCandidate(), {
      ...DEFAULT_GENERATION_CONFIG,
      healthFloor: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('board-health-floor');
  });

  it('rejects an obviously garbage board via the geometric pre-filter', async () => {
    const result = await assemblePuzzle(comboEngine(), holeyCandidate());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('geometry-prefilter');
  });

  it('rejects a candidate whose best combo changes with tap speed', async () => {
    const result = await assemblePuzzle(comboEngine({ speedVariant: true }), sampleCandidate());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('best-combo-speed-variant');
  });
});

describe('generateBank (deterministic)', () => {
  it('stores only surviving puzzles and reports rejections', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        source: new FixedSource([sampleCandidate(), sampleCandidate(), sampleCandidate()]),
        engine: comboEngine(),
        db,
      },
      { targetCount: 2, maxCandidates: 10 },
    );

    expect(result.stored).toHaveLength(2);
    expect(stored).toHaveLength(2); // stopped at targetCount, did not try the third
    expect(result.candidatesTried).toBe(2);
    expect(stored[0].combos!.entries[0].score).toBe(100);
  });

  it('replaces the bank: deletes existing puzzles after assembling survivors, then inserts', async () => {
    const { db, stored, order } = recordingDb();
    const result = await generateBank(
      {
        source: new FixedSource([sampleCandidate(), sampleCandidate()]),
        engine: comboEngine(),
        db,
      },
      { targetCount: 2, maxCandidates: 10, replace: true },
    );

    expect(result.stored).toHaveLength(2);
    expect(stored).toHaveLength(2);
    expect(order).toEqual(['delete', 'insert']);
  });

  it('records the rejection reason when nothing survives', async () => {
    const { db } = recordingDb();
    const result = await generateBank(
      { source: new FixedSource([holeyCandidate()]), engine: comboEngine(), db },
      { targetCount: 5, maxCandidates: 10 },
    );
    expect(result.stored).toHaveLength(0);
    expect(result.rejections['geometry-prefilter']).toBe(1);
  });
});

// --- Live integration smoke test (real engine, in-memory db) ----------------
const baseUrl = process.env.STACKRABBIT_URL ?? DEFAULT_BASE_URL;
const engineUp = await new StackRabbitClient({ baseUrl }).ping();

describe.skipIf(!engineUp)('generateBank (live engine)', () => {
  it('produces a small bank of well-formed combo puzzles', async () => {
    const engine = new StackRabbitClient({ baseUrl });
    const source = new SelfPlayBoardSource(engine, Math.random, {
      minDepth: 6,
      maxDepth: 14,
      noiseRate: 0.2,
    });
    const { db, stored } = recordingDb();

    const result = await generateBank(
      { source, engine, db },
      { targetCount: 2, maxCandidates: 80 },
    );

    expect(result.stored.length).toBeGreaterThan(0);
    for (const puzzle of stored) {
      expect(puzzle.board).toHaveLength(200);
      expect(isPiece(puzzle.piece1)).toBe(true);
      expect(isPiece(puzzle.piece2)).toBe(true);
      expect(puzzle.optimalLine).toHaveLength(2);
      expect(puzzle.optimalMetrics.holes).toBeGreaterThanOrEqual(0);
      // The colour grid and combo table are present and well-formed (#33).
      expect(puzzle.colors).toHaveLength(200);
      expect(/^[0-3]{200}$/.test(puzzle.colors!)).toBe(true);
      const combos = puzzle.combos!;
      expect(combos.entries.length).toBeGreaterThan(0);
      expect(combos.entries.length).toBeLessThanOrEqual(DEFAULT_GENERATION_CONFIG.topK);
      expect(combos.total).toBeGreaterThanOrEqual(combos.entries.length);
      expect(combos.entries[0].score).toBe(100);
      // The optimal line is the rank-1 combo.
      const top = combos.entries[0];
      expect(puzzle.optimalLine[0]).toEqual({ rotation: top.rot1, col: top.col1 });
      expect(puzzle.optimalLine[1]).toEqual({ rotation: top.rot2, col: top.col2 });
    }
  }, 180_000);
});
