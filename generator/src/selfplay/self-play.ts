/**
 * Self-play board source (#8) — the v1 implementation of {@link BoardSource}.
 *
 * It plays from an empty board with a mostly-optimal policy (the StackRabbit
 * engine, #4), occasionally injecting a random legal move so the resulting
 * stacks accumulate the imperfections that make interesting puzzles. It
 * snapshots at a random mid-game depth and reports the next two pieces as the
 * candidate's current/next piece.
 *
 * Per the project's testing decisions the stochastic policy itself is NOT
 * unit-targeted; its *output shape* is checked via an integration smoke test
 * against a live engine, and the deterministic loop mechanics are checked with
 * an all-random (engine-free) policy and a seeded RNG.
 */

import {
  PIECES,
  COLS,
  ORIENTATIONS,
  applyPlacement,
  cloneBoard,
  emptyBoard,
  type Grid,
  type Piece,
  type Placement,
} from '@trainer/core';
import type { MoveQuery, EngineMove } from '../engine/client.js';
import type { BoardSource, Candidate } from './board-source.js';

/** The slice of the engine client self-play needs (a best-move oracle). */
export interface MoveEngine {
  getBestMove(query: MoveQuery): Promise<EngineMove | null>;
}

/** Tuning for the self-play policy. */
export interface SelfPlayConfig {
  /** NES level to play at (and store on candidates). */
  level: number;
  /** Minimum number of pieces placed before snapshotting. */
  minDepth: number;
  /** Maximum number of pieces placed before snapshotting. */
  maxDepth: number;
  /** Probability that any given move is a random legal move instead of optimal. */
  noiseRate: number;
  /** Input-frame timeline used when querying the engine for the optimal move. */
  inputFrameTimeline: string;
}

const DEFAULT_CONFIG: SelfPlayConfig = {
  level: 18,
  minDepth: 6,
  maxDepth: 24,
  noiseRate: 0.15,
  inputFrameTimeline: 'X.....',
};

/** All legal resting placements of `piece` on `board` (rotation + column). */
export function enumerateLegalMoves(board: Grid, piece: Piece): Placement[] {
  const moves: Placement[] = [];
  const rotations = ORIENTATIONS[piece].length;
  for (let rotation = 0; rotation < rotations; rotation++) {
    for (let col = 0; col < COLS; col++) {
      try {
        applyPlacement(board, piece, { rotation, col });
        moves.push({ rotation, col });
      } catch {
        // Off the edge or no room to enter — not a legal placement.
      }
    }
  }
  return moves;
}

/**
 * A self-play implementation of {@link BoardSource}. Construct it with a
 * best-move engine and (optionally) a seeded RNG and config; each `next()`
 * call plays an independent game from empty and returns one mid-game snapshot.
 */
export class SelfPlayBoardSource implements BoardSource {
  private readonly engine: MoveEngine;
  private readonly rng: () => number;
  private readonly config: SelfPlayConfig;

  constructor(
    engine: MoveEngine,
    rng: () => number = Math.random,
    config: Partial<SelfPlayConfig> = {},
  ) {
    this.engine = engine;
    this.rng = rng;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private randomPiece(): Piece {
    return PIECES[Math.floor(this.rng() * PIECES.length)];
  }

  /** Pick a uniformly random legal placement, or `null` if the board is topped out. */
  private randomLegalMove(board: Grid, piece: Piece): Placement | null {
    const moves = enumerateLegalMoves(board, piece);
    if (moves.length === 0) return null;
    return moves[Math.floor(this.rng() * moves.length)];
  }

  async next(): Promise<Candidate> {
    const { level, minDepth, maxDepth, noiseRate, inputFrameTimeline } = this.config;
    const depth = minDepth + Math.floor(this.rng() * (maxDepth - minDepth + 1));

    // One extra piece beyond the snapshot so the candidate has a "next" piece.
    const sequence: Piece[] = Array.from({ length: depth + 2 }, () => this.randomPiece());

    let board = emptyBoard();
    const lines = 0;

    for (let i = 0; i < depth; i++) {
      const current = sequence[i];
      const next = sequence[i + 1];
      const useEngine = this.rng() >= noiseRate;

      let nextBoard: Grid | null = null;
      if (useEngine) {
        const move = await this.engine.getBestMove({
          board,
          currentPiece: current,
          nextPiece: next,
          level,
          lines,
          inputFrameTimeline,
        });
        nextBoard = move ? move.board : null;
      }
      if (!nextBoard) {
        const random = this.randomLegalMove(board, current);
        if (!random) break; // topped out — snapshot what we have
        nextBoard = applyPlacement(board, current, random);
      }
      board = nextBoard;
    }

    return {
      board: cloneBoard(board),
      currentPiece: sequence[sequence.length - 2],
      nextPiece: sequence[sequence.length - 1],
      level,
      lines,
    };
  }
}
