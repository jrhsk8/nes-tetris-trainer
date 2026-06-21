import { describe, it, expect } from 'vitest';
import {
  applyPlacement,
  emptyBoard,
  emptyColorGrid,
  encodeBoard,
  holes,
  isPiece,
  type Grid,
  type Piece,
} from '@trainer/core';
import type { NewPuzzle, Puzzle } from '@trainer/data';
import {
  assemblePuzzle,
  generateBank,
  DEFAULT_GENERATION_CONFIG,
  type GeneratorEngine,
} from './generate.js';
import { EASY_SEED, HARD_SEED } from './difficulty.js';
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
 * A controllable fake engine for the combo pipeline:
 *  - `getBestMove` reports a constant board-health `totalValue` for every piece.
 *  - `rateMove` values a combo by the sum of the row indices of its resulting
 *    filled cells, so distinct outcomes get distinct values and the sweep ranks.
 */
function comboEngine(opts: { health?: number } = {}): GeneratorEngine {
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
    async rateMove(_query: MoveQuery, after: Grid): Promise<RateMoveResult> {
      let v = 0;
      for (let r = 0; r < after.length; r++)
        for (let c = 0; c < after[r].length; c++) if (after[r][c]) v += r;
      return { playerValue: v, bestValue: 0 };
    },
  };
}

/**
 * A fake engine that REWARDS buried holes (`rateMove` returns the resulting
 * board's hole count). The holiest resulting board scores highest, so the
 * engine's value-best combo buries holes a cleaner swept alternative avoids —
 * the #50 holey-optimal bug shape.
 */
function holeyEngine(): GeneratorEngine {
  return {
    async getBestMove(query: MoveQuery): Promise<EngineMove | null> {
      return {
        rotation: 0,
        x: 0,
        y: 0,
        board: applyPlacement(query.board, query.currentPiece, { rotation: 0, col: 0 }),
        totalValue: 100,
      };
    },
    async rateMove(_query: MoveQuery, after: Grid): Promise<RateMoveResult> {
      return { playerValue: holes(after), bestValue: 0 };
    },
  };
}

/**
 * A candidate with a deep one-wide well (col 5, depth 4) under a flat height-4
 * surface. An I piece dropped vertically fills the well cleanly; an I laid across
 * the top buries the well as 4 holes — so a hole-rewarding engine's value-best is
 * egregiously holey while a clean alternative exists.
 */
function wellCandidate(): Candidate {
  const board: Grid = emptyBoard();
  for (let r = 16; r < 20; r++) for (let c = 0; c < 10; c++) if (c !== 5) board[r][c] = 1;
  return { ...sampleCandidate(), currentPiece: 'I', nextPiece: 'I', board };
}

/** A candidate whose start board is near-topout tall (passes holes/bumpiness). */
function tallCandidate(): Candidate {
  const board: Grid = emptyBoard();
  for (let r = 20 - 14; r < 20; r++) for (let c = 0; c < 9; c++) board[r][c] = 1; // 14 tall, no holes
  return { ...sampleCandidate(), board };
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
        number: i + 1,
        ...p,
        glicko: { rating: p.glicko?.rating ?? 1500, deviation: 350, volatility: 0.06 },
        colors: p.colors ?? '',
        combos: p.combos ?? { entries: [], total: 0 },
        acceptCount: p.acceptCount ?? null,
        margin: p.margin ?? null,
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

const candidateWith = (piece1: Piece, piece2: Piece): Candidate => ({
  board: emptyBoard(),
  colors: emptyColorGrid(),
  currentPiece: piece1,
  nextPiece: piece2,
  level: 18,
  lines: 0,
});

const sampleCandidate = (): Candidate => candidateWith('O', 'O');

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

describe('assemblePuzzle combo pipeline (#40)', () => {
  it('stores a normalized top-K combo table (with boardKeys) and a difficulty seed rating', async () => {
    const result = await assemblePuzzle(comboEngine(), sampleCandidate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const puzzle = result.puzzle;

    expect(puzzle.board).toBe(encodeBoard(emptyBoard()));
    expect(puzzle.piece1).toBe('O');
    expect(puzzle.piece2).toBe('O');

    // A ranked, de-duplicated-by-outcome combo table; rank-1 scores exactly 100.
    expect(puzzle.combos!.total).toBeGreaterThan(0);
    expect(puzzle.combos!.entries.length).toBe(Math.min(30, puzzle.combos!.total));
    expect(puzzle.combos!.entries[0].score).toBe(100);
    for (let i = 1; i < puzzle.combos!.entries.length; i++) {
      expect(puzzle.combos!.entries[i - 1].score).toBeGreaterThanOrEqual(
        puzzle.combos!.entries[i].score,
      );
    }
    // Every stored entry carries its outcome boardKey (#42).
    expect(puzzle.combos!.entries.every((e) => /^[01]{200}$/.test(e.boardKey!))).toBe(true);

    // The optimal line is the rank-1 combo's resting (rotation, col).
    const top = puzzle.combos!.entries[0];
    expect(puzzle.optimalLine[0]).toEqual({ rotation: top.rot1, col: top.col1 });
    expect(puzzle.optimalLine[1]).toEqual({ rotation: top.rot2, col: top.col2 });

    // Difficulty signals + seed rating are populated and in range.
    expect(typeof puzzle.acceptCount).toBe('number');
    expect(puzzle.acceptCount!).toBeGreaterThanOrEqual(1);
    expect(typeof puzzle.margin).toBe('number');
    expect(puzzle.glicko!.rating!).toBeGreaterThanOrEqual(EASY_SEED);
    expect(puzzle.glicko!.rating!).toBeLessThanOrEqual(HARD_SEED);

    expect(puzzle.colors).toHaveLength(200);
  });

  it('rejects a candidate below the board-health floor', async () => {
    const result = await assemblePuzzle(comboEngine({ health: -5 }), sampleCandidate(), {
      ...DEFAULT_GENERATION_CONFIG,
      healthFloor: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('board-health-floor');
  });

  it('keeps a playable board under the relaxed (fairness-only) default floor', async () => {
    // health -5 is far above the relaxed default floor, so the board survives.
    const result = await assemblePuzzle(comboEngine({ health: -5 }), sampleCandidate());
    expect(result.ok).toBe(true);
  });

  it('rejects an obviously garbage board via the geometric pre-filter', async () => {
    const result = await assemblePuzzle(comboEngine(), holeyCandidate());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('geometry-prefilter');
  });

  it('rejects a candidate whose best swept combo buries holes a cleaner line avoids (#50)', async () => {
    const result = await assemblePuzzle(holeyEngine(), wellCandidate());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rank1-holey');
  });

  it('rejects a near-topout start board via the re-tightened floor (#50)', async () => {
    const result = await assemblePuzzle(comboEngine(), tallCandidate());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('start-too-tall');
  });
});

describe('generateBank (deterministic)', () => {
  it('stores only surviving puzzles and reports rejections', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        source: new FixedSource([
          candidateWith('O', 'O'),
          candidateWith('I', 'O'),
          candidateWith('T', 'O'),
        ]),
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

  it('rejects a near-duplicate of an already-accepted puzzle (#40)', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        // Two identical candidates (same pieces, same board) — the second is a
        // near-duplicate (Hamming 0) and is rejected.
        source: new FixedSource([candidateWith('O', 'O'), candidateWith('O', 'O')]),
        engine: comboEngine(),
        db,
      },
      { targetCount: 2, maxCandidates: 10 },
    );

    expect(stored).toHaveLength(1);
    expect(result.rejections['duplicate']).toBe(1);
  });

  it('rejects a candidate near-identical to the existing bank (#40)', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        source: new FixedSource([candidateWith('O', 'O')]),
        engine: comboEngine(),
        db,
        existingKeys: [{ piece1: 'O', piece2: 'O', board: emptyBoard() }],
      },
      { targetCount: 1, maxCandidates: 10 },
    );

    expect(stored).toHaveLength(0);
    expect(result.rejections['duplicate']).toBe(1);
  });

  it('replaces the bank: deletes existing puzzles after assembling survivors, then inserts', async () => {
    const { db, stored, order } = recordingDb();
    const result = await generateBank(
      {
        source: new FixedSource([candidateWith('O', 'O'), candidateWith('I', 'O')]),
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
  it('produces a small bank of well-formed v2 combo puzzles', async () => {
    const engine = new StackRabbitClient({ baseUrl });
    const source = new SelfPlayBoardSource(engine, Math.random, {
      minDepth: 6,
      maxDepth: 14,
      noiseRate: 0.2,
    });
    const { db, stored } = recordingDb();

    const result = await generateBank({ source, engine, db }, { targetCount: 2, maxCandidates: 80 });

    expect(result.stored.length).toBeGreaterThan(0);
    for (const puzzle of stored) {
      expect(puzzle.board).toHaveLength(200);
      expect(isPiece(puzzle.piece1)).toBe(true);
      expect(isPiece(puzzle.piece2)).toBe(true);
      expect(puzzle.optimalLine).toHaveLength(2);
      expect(puzzle.optimalMetrics.holes).toBeGreaterThanOrEqual(0);
      // Colour grid + v2 combo table with boardKeys + difficulty seed.
      expect(/^[0-3]{200}$/.test(puzzle.colors!)).toBe(true);
      const combos = puzzle.combos!;
      expect(combos.entries.length).toBeGreaterThan(0);
      expect(combos.entries.length).toBeLessThanOrEqual(DEFAULT_GENERATION_CONFIG.topK);
      expect(combos.total).toBeGreaterThanOrEqual(combos.entries.length);
      expect(combos.entries[0].score).toBe(100);
      expect(combos.entries.every((e) => /^[01]{200}$/.test(e.boardKey!))).toBe(true);
      const top = combos.entries[0];
      expect(puzzle.optimalLine[0]).toEqual({ rotation: top.rot1, col: top.col1 });
      expect(puzzle.optimalLine[1]).toEqual({ rotation: top.rot2, col: top.col2 });
      // Difficulty + seed rating present.
      expect(typeof puzzle.acceptCount).toBe('number');
      expect(puzzle.glicko!.rating!).toBeGreaterThanOrEqual(EASY_SEED);
      expect(puzzle.glicko!.rating!).toBeLessThanOrEqual(HARD_SEED);
    }
  }, 180_000);
});
