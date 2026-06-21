/**
 * Generation pipeline (#9; rewired for v2 in #40) — turn self-play candidates
 * (#8) into stored puzzles (docs/PRD-v1.md "Generation pipeline";
 * docs/decisions.md 2026-06-21).
 *
 * For each candidate it sweeps the full two-piece combo cross-product over every
 * collision-reachable resting placement (tucks/spins included, #37), values each
 * via StackRabbit (#4), applies the v2 gates, and — for survivors — assembles
 * the stored puzzle: board, pieces, the normalized top-K combo table (each entry
 * with its outcome `boardKey`, #42), difficulty (`acceptCount` + `margin`) mapped
 * to a seed rating (#40), precomputed optimal-result metrics, and the colour
 * grid — written via the data-access layer (#2).
 */

import {
  applyRestingPlacement,
  boardMetrics,
  encodeBoard,
  encodeColors,
  type Grid,
  type Line,
} from '@trainer/core';
import type { DataAccess, NewPuzzle, Puzzle } from '@trainer/data';
import type { EngineMove, MoveQuery, RateMoveResult } from '../engine/client.js';
import { passesGeometricPrefilter } from '../quality/filters.js';
import type { BoardSource, Candidate } from '../selfplay/board-source.js';
import {
  boardHealth,
  isReachablePlacement,
  normalizeCombos,
  normalizedScores,
  rank1QualityReason,
  rankCombosBySanity,
  sweepCombos,
  type ComboContext,
} from './combo.js';
import { difficultyFromScores, seedRatingFor } from './difficulty.js';
import { isNearDuplicate, type BankKey } from './dedup.js';

/** The engine surface the pipeline needs (best move + move rating). */
export interface GeneratorEngine {
  getBestMove(query: MoveQuery): Promise<EngineMove | null>;
  rateMove(query: MoveQuery, playerBoardAfter: Grid): Promise<RateMoveResult>;
}

/** Tuning for the v2 combo gates (#40). */
export interface GenerationConfig {
  /** Top-K combos to store per puzzle. */
  topK: number;
  /**
   * Board-health floor (relaxed in v2 to fairness/garbage-only, #40): keep a
   * candidate only if the min over the 7 piece types of
   * `getBestMove(board, piece).totalValue` is at least this. The default is set
   * so only genuinely unfair boards — where some piece has NO legal move, giving
   * `boardHealth` `-Infinity` — are rejected; the difficulty target shapes the
   * rest. Tunable via --floor.
   */
  healthFloor: number;
  /** Geometric pre-filter: drop candidates with more holes than this. */
  maxHoles: number;
  /** Geometric pre-filter: drop candidates bumpier than this. */
  maxBumpiness: number;
  /**
   * Re-tightened board-health floor (#50): reject a candidate whose tallest
   * START column exceeds this. Tall / near-topped-out board0s are what let
   * StackRabbit's eval-only value crown a degenerate tower/holey board as #1, so
   * they are rejected before the sweep rather than gated after.
   */
  maxStartHeight: number;
  /**
   * Input timeline used to value combos. Permissive enough to value the
   * intended placements; tuck/spin capability is granted (not gated) in v2, so
   * combos the engine cannot reach under this timeline are simply skipped.
   */
  valuationTimeline: string;
  /**
   * Near-duplicate threshold (#40): reject a candidate whose `(piece1, piece2)`
   * match and whose board is within this many differing cells of an already
   * accepted puzzle.
   */
  dedupMaxHamming: number;
}

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  topK: 30,
  // Relaxed to fairness/garbage-only (#40): boardHealth returns -Infinity only
  // when some piece has no legal placement (an unfair board); a finite floor far
  // below any real eval keeps every playable board and rejects only that garbage.
  healthFloor: -1_000_000,
  // Holes ≤ 4 / bumpiness ≤ 32 keeps starting boards visibly clean.
  maxHoles: 4,
  maxBumpiness: 32,
  // Re-tightened (#50): reject near-topout starts (well is 20 tall). 12 leaves
  // ample build room while excluding the tall boards that produce bad rank-1s.
  maxStartHeight: 12,
  // Slow-tap timeline, proven against the live engine for hard-drop placements.
  // Tuck valuation against the live engine is the E smoke-test de-risk item; this
  // is configurable so a more permissive timeline can be tuned in there.
  valuationTimeline: 'X.....',
  dedupMaxHamming: 4,
};

/** Outcome of trying to assemble a puzzle from one candidate. */
export type AssemblyResult = { ok: true; puzzle: NewPuzzle } | { ok: false; reason: string };

/**
 * Build a stored puzzle from a candidate, or reject it with a reason (#40).
 * Fail-fast order: a cheap geometric pre-filter, then the relaxed board-health
 * (fairness) floor, then the full reachability-based combo cross-product sweep,
 * then a reachability guard on the rank-1 combo (the narrowed Hz check — tuck
 * capability is granted, so the surviving requirement is that the optimal is a
 * genuinely reachable placement). Survivors store the normalized top-K combo
 * table (with outcome `boardKey`s), difficulty + seed rating, and the optimal
 * line derived from the rank-1 combo.
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

  // 1b. Re-tightened board-health floor (#50): reject near-topout starts that
  //     lead StackRabbit to crown degenerate tower/holey boards as the optimal.
  const startHeights = boardMetrics(board).columnHeights;
  if (Math.max(...startHeights) > config.maxStartHeight) {
    return { ok: false, reason: 'start-too-tall' };
  }

  // 2. Relaxed board-health (fairness) floor (engine, piece-independent).
  const health = await boardHealth(engine, board, level, lines, config.valuationTimeline);
  if (health < config.healthFloor) return { ok: false, reason: 'board-health-floor' };

  const ctx: ComboContext = { board, piece1: currentPiece, piece2: nextPiece, level, lines };

  // 3. Full cross-product combo sweep over all reachable resting placements.
  const combos = await sweepCombos(engine, ctx, config.valuationTimeline);
  if (combos.length === 0) return { ok: false, reason: 'no-rateable-combos' };

  // 3b. Outcome-quality gate (#50): reject the puzzle when the engine's value-best
  //     combo is a needlessly holey/tall "optimal" — Pareto-dominated by, or a
  //     tower beside, a strictly cleaner swept alternative. (Checked against the
  //     engine's value-best, before the dominance-respecting re-rank below.)
  const qualityReason = rank1QualityReason(combos[0], combos);
  if (qualityReason) return { ok: false, reason: qualityReason };

  // Dominance-respecting rank order (#50): the stored "optimal" must never be a
  // strictly-worse board than a cleaner alternative. Past the gate, rank-1 equals
  // the engine's value-best (it is Pareto-clean), so the optimal is unchanged.
  const ranked = rankCombosBySanity(combos);
  const best = ranked[0];

  // 4. Narrowed Hz-invariance: the stored optimal must be a genuinely reachable
  //    resting placement (tuck capability granted, not gated — #40). Both pieces
  //    must be reachable: piece 1 on the start board, piece 2 on the board after
  //    the rank-1 first placement.
  const boardAfter1 = applyRestingPlacement(board, currentPiece, best.p1);
  const reachable =
    isReachablePlacement(board, currentPiece, best.p1) &&
    isReachablePlacement(boardAfter1, nextPiece, best.p2);
  if (!reachable) return { ok: false, reason: 'optimal-unreachable' };

  // 5. Normalize to 0–100, derive difficulty + seed rating, and build the table.
  const scores = normalizedScores(ranked);
  const difficulty = difficultyFromScores(scores);
  const seed = seedRatingFor(difficulty);
  const table = normalizeCombos(ranked, config.topK);
  const optimalLine: Line = [
    { rotation: best.p1.rotation, col: best.p1.col },
    { rotation: best.p2.rotation, col: best.p2.col },
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
      combos: table,
      acceptCount: difficulty.acceptCount,
      margin: difficulty.margin,
      glicko: { rating: seed },
    },
  };
}

/** Dependencies for a bank-generation run. */
export interface GenerateBankDeps {
  source: BoardSource;
  engine: GeneratorEngine;
  db: Pick<DataAccess, 'insertPuzzles'> & Partial<Pick<DataAccess, 'deleteAllPuzzles'>>;
  /**
   * Optional existing-bank dedup keys (#40): a candidate near-identical to one of
   * these is rejected. For a full-replace regen the bank is wiped, so this is
   * usually empty; appends pass the current bank's keys.
   */
  existingKeys?: BankKey[];
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
 * survivors to the bank in one batch. A near-duplicate of an already-accepted
 * survivor (or of the existing bank) is rejected (#40). Returns a summary
 * including rejection reasons (the substrate for tuning the gates).
 */
export async function generateBank(
  deps: GenerateBankDeps,
  options: GenerateBankOptions,
): Promise<BankResult> {
  const config = { ...DEFAULT_GENERATION_CONFIG, ...options.config };
  const onProgress = options.onProgress ?? (() => {});
  const survivors: NewPuzzle[] = [];
  const rejections: Record<string, number> = {};
  // Dedup keys: the existing bank plus every survivor accepted so far.
  const acceptedKeys: BankKey[] = [...(deps.existingKeys ?? [])];
  let candidatesTried = 0;

  while (survivors.length < options.targetCount && candidatesTried < options.maxCandidates) {
    const candidate = await deps.source.next();
    if (!candidate) break;
    candidatesTried++;

    const result = await assemblePuzzle(deps.engine, candidate, config);
    if (!result.ok) {
      rejections[result.reason] = (rejections[result.reason] ?? 0) + 1;
      continue;
    }

    const key: BankKey = {
      piece1: candidate.currentPiece,
      piece2: candidate.nextPiece,
      board: candidate.board,
    };
    if (isNearDuplicate(key, acceptedKeys, config.dedupMaxHamming)) {
      rejections['duplicate'] = (rejections['duplicate'] ?? 0) + 1;
      continue;
    }

    survivors.push(result.puzzle);
    acceptedKeys.push(key);
    onProgress(
      `accepted ${survivors.length}/${options.targetCount} (after ${candidatesTried} tried)`,
    );
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
