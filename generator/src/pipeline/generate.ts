/**
 * Generation pipeline (#9) — turn self-play candidates (#8) into stored puzzles
 * (docs/PRD-v1.md, "Generation pipeline").
 *
 * For each candidate it builds the optimal two-ply line and the second-best
 * alternatives via the engine (#4), applies the quality gates (#7), and — for
 * survivors — assembles the stored puzzle (board, pieces, optimal line,
 * precomputed optimal-result metrics via #3, flat seed rating) and writes it
 * via the data-access layer (#2).
 */

import {
  applyPlacement,
  boardMetrics,
  encodeBoard,
  encodeColors,
  type Grid,
  type Line,
  type Piece,
} from '@trainer/core';
import type { DataAccess, NewPuzzle, PlacementValue, Puzzle } from '@trainer/data';
import { isHzInvariant, isUnambiguous, type ComparableMove } from '../quality/filters.js';
import type { EngineMove, MoveQuery, RateMoveResult, ScoredMove } from '../engine/client.js';
import type { BoardSource, Candidate } from '../selfplay/board-source.js';
import { enumerateLegalMoves } from '../selfplay/self-play.js';
import { toPlacement } from './placement.js';

/** The engine surface the pipeline needs (best move, ranked moves, move rating). */
export interface GeneratorEngine {
  getBestMove(query: MoveQuery): Promise<EngineMove | null>;
  getTopMoves(query: MoveQuery): Promise<ScoredMove[]>;
  rateMove(query: MoveQuery, playerBoardAfter: Grid): Promise<RateMoveResult>;
}

/**
 * The value table for one ply (#29): every legal placement of `piece` on
 * `board`, paired with the engine's value for it. Each placement is applied in
 * OUR coordinates and scored with `rate-move`, so the resulting (rotation, col)
 * keys match the player's placements exactly. `query` carries the piece context
 * (current piece, optional lookahead, level/lines/timeline).
 */
async function computeValueTable(
  engine: GeneratorEngine,
  query: MoveQuery,
  board: Grid,
  piece: Piece,
): Promise<PlacementValue[]> {
  const table: PlacementValue[] = [];
  for (const placement of enumerateLegalMoves(board, piece)) {
    const after = applyPlacement(board, piece, placement);
    let value: number;
    try {
      value = (await engine.rateMove(query, after)).playerValue;
    } catch {
      // The engine can't value every geometrically-legal placement: a far
      // column may be unreachable under the query's input timeline, so
      // `rate-move` reports "player move not found". Such a placement is not a
      // fair alternative — skip it rather than abort the whole table.
      continue;
    }
    table.push({ rotation: placement.rotation, col: placement.col, value });
  }
  return table;
}

/** Tuning for the quality gates. */
export interface GenerationConfig {
  /** Minimum best-vs-second-best margin for the fairness gate (both plies). */
  unambiguityThreshold: number;
  /** Slow-tap input timeline for the Hz-invariance gate. */
  slowTimeline: string;
  /** Fast-DAS input timeline for the Hz-invariance gate. */
  fastTimeline: string;
}

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  // Calibrated against the live engine on self-play candidates: at a margin of 8
  // (playout-score units) ~35-40% of speed-invariant candidates survive and the
  // dominant rejection becomes ply ambiguity — the fairness intent of the gate.
  unambiguityThreshold: 8,
  slowTimeline: 'X.....',
  fastTimeline: 'X.',
};

/** Outcome of trying to assemble a puzzle from one candidate. */
export type AssemblyResult = { ok: true; puzzle: NewPuzzle } | { ok: false; reason: string };

const asComparable = (move: EngineMove): ComparableMove => ({ rotation: move.rotation, x: move.x });

/**
 * Build a stored puzzle from a candidate, or reject it with a reason. Applies,
 * in fail-fast order, the fairness (unambiguity) and Hz-invariance gates to
 * both plies; survivors get their optimal line and optimal-result metrics
 * computed.
 */
export async function assemblePuzzle(
  engine: GeneratorEngine,
  candidate: Candidate,
  config: GenerationConfig = DEFAULT_GENERATION_CONFIG,
): Promise<AssemblyResult> {
  const { board, currentPiece, nextPiece, level, lines } = candidate;
  const slow = config.slowTimeline;
  const fast = config.fastTimeline;

  const ply1 = (timeline: string): MoveQuery => ({
    board,
    currentPiece,
    nextPiece,
    level,
    lines,
    inputFrameTimeline: timeline,
  });

  // --- Ply 1: optimal first move (with lookahead). ---
  const move1 = await engine.getBestMove(ply1(slow));
  if (!move1) return { ok: false, reason: 'no-legal-first-move' };
  const placement1 = toPlacement(board, currentPiece, move1.board);
  if (!placement1) return { ok: false, reason: 'first-move-not-representable' };
  const board1 = move1.board;

  // Fairness gate, ply 1: the best must clearly beat the second-best.
  const top1 = await engine.getTopMoves(ply1(slow));
  if (
    top1.length < 2 ||
    !isUnambiguous(top1[0].totalValue, top1[1].totalValue, config.unambiguityThreshold)
  ) {
    return { ok: false, reason: 'ply1-ambiguous' };
  }

  // Hz-invariance gate, ply 1: the optimal move must not change with speed.
  const fast1 = await engine.getBestMove(ply1(fast));
  if (!fast1 || !isHzInvariant([asComparable(move1), asComparable(fast1)])) {
    return { ok: false, reason: 'ply1-speed-variant' };
  }

  const ply2 = (timeline: string): MoveQuery => ({
    board: board1,
    currentPiece: nextPiece,
    nextPiece: null,
    level,
    lines,
    inputFrameTimeline: timeline,
  });

  // --- Ply 2: optimal second move (no lookahead). ---
  const move2 = await engine.getBestMove(ply2(slow));
  if (!move2) return { ok: false, reason: 'no-legal-second-move' };
  const placement2 = toPlacement(board1, nextPiece, move2.board);
  if (!placement2) return { ok: false, reason: 'second-move-not-representable' };
  const board2 = move2.board;

  const top2 = await engine.getTopMoves(ply2(slow));
  if (
    top2.length < 2 ||
    !isUnambiguous(top2[0].totalValue, top2[1].totalValue, config.unambiguityThreshold)
  ) {
    return { ok: false, reason: 'ply2-ambiguous' };
  }

  const fast2 = await engine.getBestMove(ply2(fast));
  if (!fast2 || !isHzInvariant([asComparable(move2), asComparable(fast2)])) {
    return { ok: false, reason: 'ply2-speed-variant' };
  }

  // Value tables for the solutions chart (#29): every legal placement of each
  // piece with its engine value. Ply 1 is scored with the lookahead (optimal
  // follow-up); ply 2 is scored on the post-optimal-move board with no
  // lookahead — mirroring how the two plies are graded.
  const firstValues = await computeValueTable(engine, ply1(slow), board, currentPiece);
  const secondValues = await computeValueTable(engine, ply2(slow), board1, nextPiece);

  const optimalLine: Line = [placement1, placement2];
  return {
    ok: true,
    puzzle: {
      board: encodeBoard(board),
      piece1: currentPiece,
      piece2: nextPiece,
      optimalLine,
      optimalMetrics: boardMetrics(board2),
      colors: encodeColors(candidate.colors),
      firstValues,
      secondValues,
    },
  };
}

/** Dependencies for a bank-generation run. */
export interface GenerateBankDeps {
  source: BoardSource;
  engine: GeneratorEngine;
  db: Pick<DataAccess, 'insertPuzzles'> & Partial<Pick<DataAccess, 'deleteAllPuzzles'>>;
}

/** Options controlling a bank-generation run. */
export interface GenerateBankOptions {
  /** How many surviving puzzles to produce and store. */
  targetCount: number;
  /** Safety cap on candidates tried (the gates reject most). */
  maxCandidates: number;
  /** Quality-gate tuning; defaults to {@link DEFAULT_GENERATION_CONFIG}. */
  config?: Partial<GenerationConfig>;
  /**
   * Replace the whole bank instead of appending: once all survivors are
   * assembled (and only then, to keep the empty-bank window minimal), delete
   * every existing puzzle — cascading its attempts — before inserting the new
   * set. Requires `deps.db.deleteAllPuzzles`.
   */
  replace?: boolean;
  /** Optional progress callback (one line per event). */
  onProgress?: (message: string) => void;
}

/** Summary of a bank-generation run. */
export interface BankResult {
  /** The puzzles written to the bank. */
  stored: Puzzle[];
  /** How many candidates were evaluated. */
  candidatesTried: number;
  /** Count of rejections by reason. */
  rejections: Record<string, number>;
}

/**
 * Run candidates from `source` through the pipeline until `targetCount`
 * survivors are assembled or `maxCandidates` are exhausted, then write the
 * survivors to the bank in one batch. Returns a summary including rejection
 * reasons (the substrate for tuning the gates).
 */
export async function generateBank(
  deps: GenerateBankDeps,
  options: GenerateBankOptions,
): Promise<BankResult> {
  const config = { ...DEFAULT_GENERATION_CONFIG, ...options.config };
  const onProgress = options.onProgress ?? (() => {});
  const survivors: NewPuzzle[] = [];
  const rejections: Record<string, number> = {};
  let candidatesTried = 0;

  while (survivors.length < options.targetCount && candidatesTried < options.maxCandidates) {
    const candidate = await deps.source.next();
    if (!candidate) break;
    candidatesTried++;

    const result = await assemblePuzzle(deps.engine, candidate, config);
    if (result.ok) {
      survivors.push(result.puzzle);
      onProgress(
        `accepted ${survivors.length}/${options.targetCount} (after ${candidatesTried} tried)`,
      );
    } else {
      rejections[result.reason] = (rejections[result.reason] ?? 0) + 1;
    }
  }

  if (options.replace) {
    if (!deps.db.deleteAllPuzzles) {
      throw new Error('replace requested but deps.db.deleteAllPuzzles is unavailable');
    }
    const removed = await deps.db.deleteAllPuzzles();
    onProgress(`replaced: deleted ${removed} existing puzzles (attempts cascade)`);
  }

  const stored = await deps.db.insertPuzzles(survivors);
  onProgress(`stored ${stored.length} puzzles`);
  return { stored, candidatesTried, rejections };
}
