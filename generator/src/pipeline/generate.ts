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

import { boardMetrics, encodeBoard, encodeColors, type Grid, type Line } from '@trainer/core';
import type { DataAccess, NewPuzzle, Puzzle } from '@trainer/data';
import type { EngineMove, MoveQuery, RateMoveResult } from '../engine/client.js';
import { passesGeometricPrefilter } from '../quality/filters.js';
import type { BoardSource, Candidate } from '../selfplay/board-source.js';
import {
  boardHealth,
  combosEqual,
  normalizeCombos,
  rerankAt,
  sweepCombos,
  type ComboContext,
} from './combo.js';

/** The engine surface the pipeline needs (best move + move rating). */
export interface GeneratorEngine {
  getBestMove(query: MoveQuery): Promise<EngineMove | null>;
  rateMove(query: MoveQuery, playerBoardAfter: Grid): Promise<RateMoveResult>;
}

/** Tuning for the combo gates (#33). */
export interface GenerationConfig {
  /** Top-K combos to store per puzzle. */
  topK: number;
  /**
   * Board-health floor: keep a candidate only if the min over the 7 piece types
   * of `getBestMove(board, piece).totalValue` is at least this (#33). Moderate
   * and tunable — protect yield, don't overdo it.
   */
  healthFloor: number;
  /** Geometric pre-filter: drop candidates with more holes than this. */
  maxHoles: number;
  /** Geometric pre-filter: drop candidates bumpier than this. */
  maxBumpiness: number;
  /** Slow-tap input timeline for the combo sweep + Hz-invariance gate. */
  slowTimeline: string;
  /** Fast-DAS input timeline for the Hz-invariance gate. */
  fastTimeline: string;
}

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  topK: 30,
  // Calibrated against the live engine on geometric-prefilter survivors: the
  // min-over-7-pieces eval is harsh (the worst piece often forces a hole), so
  // values run negative even on clean boards (median ≈ -40). A moderate floor of
  // -30 keeps ~45% of clean boards — protects yield while gating the worst
  // surfaces. Tune with --floor.
  healthFloor: -30,
  // Holes ≤ 4 / bumpiness ≤ 32 makes starting boards visibly cleaner than the
  // pre-#33 bank (whose holes ran a median of 8, up to 47).
  maxHoles: 4,
  maxBumpiness: 32,
  slowTimeline: 'X.....',
  fastTimeline: 'X.',
};

/** Outcome of trying to assemble a puzzle from one candidate. */
export type AssemblyResult = { ok: true; puzzle: NewPuzzle } | { ok: false; reason: string };

/**
 * Build a stored puzzle from a candidate, or reject it with a reason (#33).
 * Fail-fast order: a cheap geometric pre-filter, then the board-health floor
 * (engine, piece-independent), then the full combo cross-product sweep, then the
 * Hz-invariance gate (the best combo must be identical slow-tap and fast-DAS).
 * Survivors store the normalized top-K combo table; the optimal line is the
 * rank-1 combo (so it scores 100, consistent with combo-threshold grading #34).
 */
export async function assemblePuzzle(
  engine: GeneratorEngine,
  candidate: Candidate,
  config: GenerationConfig = DEFAULT_GENERATION_CONFIG,
): Promise<AssemblyResult> {
  const { board, currentPiece, nextPiece, level, lines } = candidate;

  // 1. Cheap geometric pre-filter: drop obvious garbage before any engine call.
  if (!passesGeometricPrefilter(board, config.maxHoles, config.maxBumpiness)) {
    return { ok: false, reason: 'geometry-prefilter' };
  }

  // 2. Board-health floor (engine, piece-independent).
  const health = await boardHealth(engine, board, level, lines, config.slowTimeline);
  if (health < config.healthFloor) return { ok: false, reason: 'board-health-floor' };

  const ctx: ComboContext = { board, piece1: currentPiece, piece2: nextPiece, level, lines };

  // 3. Full cross-product combo sweep at the slow timeline.
  const slow = await sweepCombos(engine, ctx, config.slowTimeline);
  if (slow.length === 0) return { ok: false, reason: 'no-rateable-combos' };

  // 4. Hz-invariance, retargeted to the best combo: re-value the stored top-K at
  //    the fast timeline; the rank-1 combo must still be best (and reachable).
  const fast = await rerankAt(engine, ctx, slow.slice(0, config.topK), config.fastTimeline);
  if (fast.length === 0 || !combosEqual(slow[0], fast[0])) {
    return { ok: false, reason: 'best-combo-speed-variant' };
  }

  // 5. Normalize to 0–100, keep the top-K, and derive the optimal line from the
  //    rank-1 combo (board2 is the board after both rank-1 placements).
  const combos = normalizeCombos(slow, config.topK);
  const best = slow[0];
  const optimalLine: Line = [
    { rotation: best.rot1, col: best.col1 },
    { rotation: best.rot2, col: best.col2 },
  ];

  return {
    ok: true,
    puzzle: {
      board: encodeBoard(board),
      piece1: currentPiece,
      piece2: nextPiece,
      optimalLine,
      optimalMetrics: boardMetrics(best.board2),
      colors: encodeColors(candidate.colors),
      combos,
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
