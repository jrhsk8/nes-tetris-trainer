import { describe, it, expect } from 'vitest';
import { decodeBoard } from '@trainer/core';
import type { NewPuzzle, Puzzle } from '@trainer/data';
import { StackRabbitClient, DEFAULT_BASE_URL } from '../engine/client.js';
import { SelfPlayBoardSource } from '../selfplay/self-play.js';
import { generateBank, DEFAULT_GENERATION_CONFIG } from './generate.js';
import { sweepCombos, isReachablePlacement, type ComboContext } from './combo.js';

// Deep generation-pipeline test (#14, PRD Testing surface 2): generate → filter
// → store, then INDEPENDENTLY re-verify against the live engine that every
// stored puzzle is a real v2 combo puzzle — its stored rank-1 combo is the
// engine's best (by resulting-board outcome) and is genuinely reachable (#40).
// Skipped cleanly when no engine is reachable.
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
  };
}

describe.skipIf(!engineUp)('Generation pipeline (deep, live engine)', () => {
  it('stores reachable best-combo puzzles, re-verified independently by outcome', async () => {
    const engine = new StackRabbitClient({ baseUrl });
    const source = new SelfPlayBoardSource(engine, Math.random, {
      minDepth: 6,
      maxDepth: 14,
      noiseRate: 0.2,
    });
    const db = recordingDb();

    const result = await generateBank({ source, engine, db }, { targetCount: 2, maxCandidates: 80 });
    expect(result.stored.length).toBeGreaterThan(0);

    for (const puzzle of db.stored) {
      const board = decodeBoard(puzzle.board);
      const ctx: ComboContext = {
        board,
        piece1: puzzle.piece1,
        piece2: puzzle.piece2,
        level: 18,
        lines: 0,
      };

      // Re-sweep the full cross-product at the valuation timeline (eval-only and
      // deterministic) and independently re-verify the stored optimal by OUTCOME.
      const combos = await sweepCombos(engine, ctx, DEFAULT_GENERATION_CONFIG.valuationTimeline);
      expect(combos.length).toBeGreaterThan(0);

      // The stored rank-1 is a genuine engine-swept combo, re-verified by its
      // resulting-board OUTCOME (#42 — rotation-numbering- and path-independent),
      // not a fabricated one. It is the dominance-respecting best (#50) UNLESS the
      // deeper-confirm gate (#53) reranked it to another swept combo — that gate
      // uses non-deterministic playouts, so we don't re-derive its exact pick;
      // matching by outcome key covers both the sanity-top and reranked cases.
      const top = puzzle.combos!.entries[0];
      const topCombo = combos.find((c) => c.boardKey === top.boardKey);
      expect(topCombo).toBeDefined();

      // Consistency: the stored optimal line is that rank-1 combo's (rotation, col).
      expect(puzzle.optimalLine[0]).toEqual({ rotation: top.rot1, col: top.col1 });
      expect(puzzle.optimalLine[1]).toEqual({ rotation: top.rot2, col: top.col2 });

      // The rank-1 first placement is genuinely reachable (narrowed-Hz guard) —
      // checked against the swept combo's full resting placement (tuck row and
      // all), which the stored (rotation, col) entry alone cannot express.
      expect(isReachablePlacement(board, puzzle.piece1, topCombo!.p1)).toBe(true);

      // The stored table is well-formed: rank-1 scores 100, total ≥ stored.
      expect(top.score).toBe(100);
      expect(puzzle.combos!.total).toBeGreaterThanOrEqual(puzzle.combos!.entries.length);
      // Difficulty + seed rating present.
      expect(typeof puzzle.acceptCount).toBe('number');
      expect(typeof puzzle.glicko!.rating).toBe('number');
    }
  }, 180_000);
});
