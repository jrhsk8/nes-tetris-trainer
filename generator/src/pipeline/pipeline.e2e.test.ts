import { describe, it, expect } from 'vitest';
import { decodeBoard } from '@trainer/core';
import type { NewPuzzle, Puzzle } from '@trainer/data';
import { StackRabbitClient, DEFAULT_BASE_URL } from '../engine/client.js';
import { SelfPlayBoardSource } from '../selfplay/self-play.js';
import { generateBank, DEFAULT_GENERATION_CONFIG } from './generate.js';
import { toPlacement } from './placement.js';

// Deep generation-pipeline test (#14, PRD Testing surface 2): generate → filter
// → store, then INDEPENDENTLY re-verify against the live engine that every
// stored puzzle is fair (unambiguous) and Hz-invariant — i.e. only such puzzles
// survived. Skipped cleanly when no engine is reachable.
const baseUrl = process.env.STACKRABBIT_URL ?? DEFAULT_BASE_URL;
const engineUp = await new StackRabbitClient({ baseUrl }).ping();

/** A db double that records inserts and returns them as if stored. */
function recordingDb() {
  const stored: NewPuzzle[] = [];
  return {
    stored,
    async insertPuzzles(puzzles: NewPuzzle[]): Promise<Puzzle[]> {
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
  };
}

interface Verification {
  hzInvariant: boolean;
  unambiguousMargin: number;
  matchesStored: boolean;
}

/** Re-verify one ply against the engine, returning the gate evidence. */
async function verifyPly(
  engine: StackRabbitClient,
  board: ReturnType<typeof decodeBoard>,
  currentPiece: 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L',
  nextPiece: ('I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L') | null,
  storedPlacement: { rotation: number; col: number },
  config = DEFAULT_GENERATION_CONFIG,
): Promise<Verification & { resultBoard: ReturnType<typeof decodeBoard> | null }> {
  const base = { board, currentPiece, nextPiece, level: 18, lines: 0 };
  const slow = await engine.getBestMove({ ...base, inputFrameTimeline: config.slowTimeline });
  const fast = await engine.getBestMove({ ...base, inputFrameTimeline: config.fastTimeline });
  const top = await engine.getTopMoves({ ...base, inputFrameTimeline: config.slowTimeline });

  const hzInvariant = Boolean(slow && fast && slow.rotation === fast.rotation && slow.x === fast.x);
  const unambiguousMargin = top.length >= 2 ? top[0].totalValue - top[1].totalValue : -Infinity;
  const recovered = slow ? toPlacement(board, currentPiece, slow.board) : null;
  const matchesStored = Boolean(
    recovered &&
    recovered.rotation === storedPlacement.rotation &&
    recovered.col === storedPlacement.col,
  );
  return { hzInvariant, unambiguousMargin, matchesStored, resultBoard: slow?.board ?? null };
}

describe.skipIf(!engineUp)('Generation pipeline (deep, live engine)', () => {
  it('stores only fair, Hz-invariant puzzles, re-verified independently', async () => {
    const engine = new StackRabbitClient({ baseUrl });
    const source = new SelfPlayBoardSource(engine, Math.random, {
      minDepth: 6,
      maxDepth: 14,
      noiseRate: 0.35,
    });
    const db = recordingDb();

    const result = await generateBank(
      { source, engine, db },
      { targetCount: 2, maxCandidates: 60 },
    );
    expect(result.stored.length).toBeGreaterThan(0);

    for (const puzzle of db.stored) {
      const board0 = decodeBoard(puzzle.board);

      const ply1 = await verifyPly(
        engine,
        board0,
        puzzle.piece1,
        puzzle.piece2,
        puzzle.optimalLine[0],
      );
      expect(ply1.hzInvariant).toBe(true);
      expect(ply1.unambiguousMargin).toBeGreaterThanOrEqual(
        DEFAULT_GENERATION_CONFIG.unambiguityThreshold,
      );
      expect(ply1.matchesStored).toBe(true);
      expect(ply1.resultBoard).not.toBeNull();

      const ply2 = await verifyPly(
        engine,
        ply1.resultBoard!,
        puzzle.piece2,
        null,
        puzzle.optimalLine[1],
      );
      expect(ply2.hzInvariant).toBe(true);
      expect(ply2.unambiguousMargin).toBeGreaterThanOrEqual(
        DEFAULT_GENERATION_CONFIG.unambiguityThreshold,
      );
      expect(ply2.matchesStored).toBe(true);
    }
  }, 120_000);
});
