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
  classifyLane,
  generateBank,
  DEFAULT_GENERATION_CONFIG,
  type GeneratorEngine,
} from './generate.js';
import type { ConsensusJudge, ConsensusVerdict } from './consensus.js';
import { VERY_EASY_SEED, HARD_SEED, HARD_MAX_ACCEPTS } from './difficulty.js';
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
 * An engine whose EVAL-ONLY rating and DEEPER (playoutCount > 0) rating disagree:
 * eval ranks a combo by its resulting board's filled `(row*10+col)` sum (so
 * bottom-right placements win), while the deeper search returns the negated sum —
 * inverting the ranking. The deeper-best is therefore a different, far-lower
 * eval combo, contradicting the eval-only pick well beyond the reject threshold:
 * an "eval-only quirk" the #53 gate must reject.
 */
function quirkEngine(): GeneratorEngine {
  const evalValue = (after: Grid): number => {
    let v = 0;
    for (let r = 0; r < after.length; r++)
      for (let c = 0; c < after[r].length; c++) if (after[r][c]) v += r * 10 + c;
    return v;
  };
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
    async rateMove(_query: MoveQuery, after: Grid, options?): Promise<RateMoveResult> {
      const v = evalValue(after);
      // The deeper search inverts and amplifies the ranking, so its best is a
      // far-lower eval combo — a contradiction well past the reject threshold.
      return { playerValue: options?.playoutCount ? -100 * v : v, bestValue: 0 };
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

/**
 * An engine that produces a controllable difficulty band per candidate (#52),
 * keyed off the candidate's `lines` (so the pieces/board geometry stays flat and
 * clean enough to clear the #50 quality gate in every band):
 *  - lines 2 → one dominant combo (acceptCount 1)   → hard
 *  - lines 1 → five near-tied combos (acceptCount 5) → medium
 *  - lines 0 → a flat field (all combos pass)        → easy
 * The per-candidate sweep counter resets on `getBestMove`, which runs once at the
 * start of each `assemblePuzzle` (board-health) before the `rateMove` sweep.
 */
function bandEngine(): GeneratorEngine {
  let n = 0;
  return {
    async getBestMove(query: MoveQuery): Promise<EngineMove | null> {
      n = 0;
      return {
        rotation: 0,
        x: 0,
        y: 0,
        board: applyPlacement(query.board, query.currentPiece, { rotation: 0, col: 0 }),
        totalValue: 100,
      };
    },
    async rateMove(query: MoveQuery, _after: Grid): Promise<RateMoveResult> {
      const i = n++;
      const mode = query.lines === 2 ? 'hard' : query.lines === 1 ? 'medium' : 'easy';
      const value = mode === 'easy' ? 100 : mode === 'hard' ? (i === 0 ? 1000 : 0) : i < 5 ? 1000 - i : 0;
      return { playerValue: value, bestValue: 0 };
    },
  };
}

/** A candidate with a flat, clean floor `rows` tall and a band signal in `lines`. */
function bandCandidate(rows: number, lines: number): Candidate {
  const board: Grid = emptyBoard();
  for (let r = 20 - rows; r < 20; r++) for (let c = 0; c < 10; c++) board[r][c] = 1;
  return { board, colors: emptyColorGrid(), currentPiece: 'O', nextPiece: 'O', level: 18, lines };
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

/**
 * A clean, low candidate with EXACTLY `n` holes (and tiny bumpiness): a filled
 * floor row with the leftmost `n` columns capped one row above an empty cell, so
 * each capped column is one buried hole. Used to exercise the strict/variety
 * lane split (#66) — n=0 is strict-clean, n=2 lands in the variety lane.
 */
function holesCandidate(n: number, piece1: Piece = 'O', piece2: Piece = 'O'): Candidate {
  const board: Grid = emptyBoard();
  for (let c = n; c < 10; c++) board[19][c] = 1; // floor under the un-holed columns
  for (let c = 0; c < n; c++) board[18][c] = 1; // cap over an empty cell → a hole
  return { ...sampleCandidate(), currentPiece: piece1, nextPiece: piece2, board };
}

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
    expect(puzzle.glicko!.rating!).toBeGreaterThanOrEqual(VERY_EASY_SEED);
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

  it('confirms the eval-only optimal when a deeper search agrees (#53)', async () => {
    // comboEngine ignores the deeper playout option, so eval == deep: the gate
    // confirms and the stored optimal is the eval-only rank-1, unchanged.
    const evalOnly = await assemblePuzzle(comboEngine(), sampleCandidate(), {
      ...DEFAULT_GENERATION_CONFIG,
      deeperConfirm: null,
    });
    const confirmed = await assemblePuzzle(comboEngine(), sampleCandidate());
    expect(evalOnly.ok && confirmed.ok).toBe(true);
    if (!evalOnly.ok || !confirmed.ok) return;
    expect(confirmed.puzzle.optimalLine).toEqual(evalOnly.puzzle.optimalLine);
  });

  it('rejects an eval-only-quirk optimal that a deeper search contradicts (#53)', async () => {
    const result = await assemblePuzzle(quirkEngine(), sampleCandidate());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('deeper-quirk');
  });

  it('accepts the same quirk candidate when the deeper-confirm gate is disabled (#53)', async () => {
    // Proves the rejection above is the #53 gate, not another filter.
    const result = await assemblePuzzle(quirkEngine(), sampleCandidate(), {
      ...DEFAULT_GENERATION_CONFIG,
      deeperConfirm: null,
    });
    expect(result.ok).toBe(true);
  });

  it('classifies a strict-clean board (≤1 hole, low bumpiness) into the strict lane (#66)', async () => {
    expect(classifyLane(emptyBoard(), DEFAULT_GENERATION_CONFIG)).toBe('strict');
    const result = await assemblePuzzle(comboEngine(), holesCandidate(0));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane).toBe('strict');
  });

  it('routes a 2-hole board into the variety lane, not the strict default (#66)', async () => {
    expect(classifyLane(holesCandidate(2).board, DEFAULT_GENERATION_CONFIG)).toBe('variety');
    const result = await assemblePuzzle(comboEngine(), holesCandidate(2));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane).toBe('variety');
  });

  it('rejects a 2-hole board when no variety lane is configured (strict default, #66)', async () => {
    const result = await assemblePuzzle(comboEngine(), holesCandidate(2), {
      ...DEFAULT_GENERATION_CONFIG,
      varietyLane: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('geometry-prefilter');
  });

  it('rejects a board past even the variety lane bounds (≥3 holes, #66)', async () => {
    const result = await assemblePuzzle(comboEngine(), holesCandidate(3));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('geometry-prefilter');
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

  it('reports survivors per difficulty band, summing to the stored count (#52)', async () => {
    const { db } = recordingDb();
    const result = await generateBank(
      { source: new FixedSource([candidateWith('O', 'O'), candidateWith('T', 'O')]), engine: comboEngine(), db },
      { targetCount: 2, maxCandidates: 10 },
    );
    const total =
      result.byBand['very-easy'] + result.byBand.easy + result.byBand.medium + result.byBand.hard;
    expect(total).toBe(result.stored.length);
  });

  it('spans easy→hard under per-band quotas, keeping hard puzzles tight (#52)', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        // Distinct flat boards per band so dedup never fires; the engine sets the
        // band from `lines` (0 → all-pass = very-easy / 1 medium / 2 hard, #71).
        source: new FixedSource([
          bandCandidate(4, 2), // hard
          bandCandidate(2, 1), // medium
          bandCandidate(0, 0), // very-easy (every combo passes ⇒ many accepts)
        ]),
        engine: bandEngine(),
        db,
      },
      { targetCount: 0, bandQuotas: { 'very-easy': 1, medium: 1, hard: 1 }, maxCandidates: 20 },
    );

    expect(result.byBand).toEqual({ 'very-easy': 1, easy: 0, medium: 1, hard: 1 });
    expect(stored).toHaveLength(3);
    // The hard survivor has a genuinely tight acceptable set (≤ 2).
    const hard = stored.find((p) => p.acceptCount! <= HARD_MAX_ACCEPTS);
    expect(hard).toBeDefined();
    expect(hard!.acceptCount).toBe(1);
  });

  it('caps a band at its quota, rejecting further survivors of a full band (#52)', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        // very-easy is over-supplied (2 all-pass candidates) but only has 1 slot;
        // the run keeps going for the still-unfilled hard band, so the surplus
        // very-easy is rejected.
        source: new FixedSource([
          bandCandidate(0, 0), // very-easy (accepted)
          bandCandidate(2, 0), // very-easy (band-full → rejected)
          bandCandidate(4, 2), // hard (accepted)
        ]),
        engine: bandEngine(),
        db,
      },
      { targetCount: 0, bandQuotas: { 'very-easy': 1, hard: 1 }, maxCandidates: 20 },
    );

    expect(result.byBand).toEqual({ 'very-easy': 1, easy: 0, medium: 0, hard: 1 });
    expect(stored).toHaveLength(2);
    expect(result.rejections['band-full:very-easy']).toBe(1);
  });

  it('caps the variety lane at ~fraction of the bank, filling the rest strict-clean (#66)', async () => {
    const { db, stored } = recordingDb();
    const result = await generateBank(
      {
        // Three variety-lane (2-hole) candidates lead, then strict-clean ones.
        // With target 5 and fraction 0.2 the variety cap is 1, so only the first
        // variety board is kept; the run fills the remaining 4 slots strict.
        source: new FixedSource([
          holesCandidate(2, 'O', 'O'),
          holesCandidate(2, 'I', 'O'),
          holesCandidate(2, 'T', 'O'),
          holesCandidate(0, 'S', 'O'),
          holesCandidate(0, 'Z', 'O'),
          holesCandidate(0, 'L', 'O'),
          holesCandidate(0, 'J', 'O'),
        ]),
        engine: comboEngine(),
        db,
      },
      { targetCount: 5, maxCandidates: 20 },
    );

    expect(stored).toHaveLength(5);
    expect(result.byLane.variety).toBe(1);
    expect(result.byLane.strict).toBe(4);
    expect(result.rejections['variety-lane-full']).toBe(2);
  });

  it('drops BetaTetris disagreers and tops up to target, storing only consensus puzzles (#55)', async () => {
    const { db, stored } = recordingDb();
    // The judge "disagrees" with any puzzle whose first piece is I (drops it),
    // blesses the rest. With one I in the source, the run must reach past it to
    // hit the target — i.e. the cull is topped up, not left short.
    const judge: ConsensusJudge = async (rows) =>
      rows.map<ConsensusVerdict>((r) => {
        const keep = r.piece1 !== 'I';
        return { number: r.number, id: r.id, keep, reason: keep ? null : 'disagree', rank: keep ? 1 : 2 };
      });

    const result = await generateBank(
      {
        source: new FixedSource([
          candidateWith('O', 'O'),
          candidateWith('I', 'O'), // BetaTetris disagrees → dropped
          candidateWith('T', 'O'),
          candidateWith('S', 'O'),
        ]),
        engine: comboEngine(),
        db,
        consensusJudge: judge,
      },
      { targetCount: 3, maxCandidates: 20 },
    );

    // Exactly the three blessed puzzles are stored; the I disagreer never is.
    expect(stored).toHaveLength(3);
    expect(result.stored).toHaveLength(3);
    expect(stored.map((p) => p.piece1).sort()).toEqual(['O', 'S', 'T']);
    expect(stored.some((p) => p.piece1 === 'I')).toBe(false);
    // The disagree is recorded apart from a TS-gate rejection, and the run had to
    // try the 4th candidate to top the cull back up to 3.
    expect(result.rejections['consensus:disagree']).toBe(1);
    expect(result.candidatesTried).toBe(4);
  });

  it('fail-closed: a bt-error verdict drops the puzzle and never stores it (#55)', async () => {
    const { db, stored } = recordingDb();
    const judge: ConsensusJudge = async (rows) =>
      rows.map<ConsensusVerdict>((r) => ({
        number: r.number,
        id: r.id,
        keep: false,
        reason: 'bt-error',
        rank: null,
      }));

    const result = await generateBank(
      { source: new FixedSource([candidateWith('O', 'O')]), engine: comboEngine(), db, consensusJudge: judge },
      { targetCount: 1, maxCandidates: 3 },
    );

    expect(stored).toHaveLength(0);
    expect(result.rejections['consensus:bt-error']).toBe(1);
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
      expect(puzzle.glicko!.rating!).toBeGreaterThanOrEqual(VERY_EASY_SEED);
      expect(puzzle.glicko!.rating!).toBeLessThanOrEqual(HARD_SEED);
    }
  }, 180_000);
});
