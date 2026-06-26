import { describe, it, expect, vi } from 'vitest';
import { boardMetrics, emptyBoard, encodeBoard, type Piece, type PuzzleTag } from '@trainer/core';
import type { NewPuzzle, Puzzle } from '@trainer/data';
import { insertOrDryRun, finishWithConsensus, type InsertDb } from './bank-insert.js';

function np(piece1: Piece, piece2: Piece, tags: PuzzleTag[] = []): NewPuzzle {
  return {
    board: encodeBoard(emptyBoard()),
    piece1,
    piece2,
    optimalLine: [
      { rotation: 0, col: 0 },
      { rotation: 0, col: 3 },
    ],
    optimalMetrics: boardMetrics(emptyBoard()),
    tags,
  };
}

/** A fake insert db that records each insertPuzzles call and returns stored rows. */
function fakeDb() {
  const calls: NewPuzzle[][] = [];
  const db: InsertDb = {
    async insertPuzzles(puzzles) {
      calls.push(puzzles);
      return puzzles.map(
        (p, i): Puzzle => ({
          id: `id-${i}`,
          number: 100 + i,
          board: p.board,
          piece1: p.piece1,
          piece2: p.piece2,
          optimalLine: p.optimalLine,
          optimalMetrics: p.optimalMetrics,
          glicko: { rating: 1500, deviation: 350, volatility: 0.06 },
          colors: '',
          combos: { entries: [], total: 0 },
          tags: p.tags ?? [],
          acceptCount: null,
          margin: null,
          firstValues: [],
          secondValues: [],
        }),
      );
    },
  };
  return { db, calls };
}

describe('insertOrDryRun', () => {
  it('inserts the kept puzzles and returns the stored rows', async () => {
    const { db, calls } = fakeDb();
    const kept = [np('T', 'L', ['t-spin']), np('S', 'O', ['s-spin'])];
    const stored = await insertOrDryRun(kept, { db, dryRun: false, label: 'spin puzzles', log: vi.fn() });
    expect(calls).toEqual([kept]); // inserted exactly the kept set, once
    expect(stored).toHaveLength(2);
    expect(stored[0].number).toBe(100);
  });

  it('writes nothing under --dry-run', async () => {
    const { db, calls } = fakeDb();
    const stored = await insertOrDryRun([np('T', 'L')], { db, dryRun: true, label: 'spin puzzles', log: vi.fn() });
    expect(calls).toEqual([]); // db never touched
    expect(stored).toEqual([]);
  });

  it('writes nothing for an empty kept set', async () => {
    const { db, calls } = fakeDb();
    const stored = await insertOrDryRun([], { db, dryRun: false, label: 'spin puzzles', log: vi.fn() });
    expect(calls).toEqual([]);
    expect(stored).toEqual([]);
  });

  it('applies describe() to each inserted log row', async () => {
    const { db } = fakeDb();
    const log = vi.fn();
    await insertOrDryRun([np('T', 'L', ['t-spin'])], {
      db,
      dryRun: false,
      label: 'spin puzzles',
      log,
      describe: (p) => (p.tags ?? []).join('+'),
    });
    const rows = log.mock.calls.map((c) => String(c[0]));
    expect(rows.some((r) => r.includes('#100 T+L (t-spin)'))).toBe(true);
  });
});

describe('finishWithConsensus', () => {
  it('inserts nothing when there are no survivors (consensus short-circuits the judge)', async () => {
    const { db, calls } = fakeDb();
    let judged = false;
    const { consensus, stored } = await finishWithConsensus([], {
      db,
      dryRun: false,
      label: 'spin puzzles',
      log: vi.fn(),
      judge: async () => {
        judged = true;
        return [];
      },
      existingKeys: [],
      maxHamming: 6,
    });
    expect(consensus.kept).toEqual([]);
    expect(stored).toEqual([]);
    expect(calls).toEqual([]); // nothing inserted
    expect(judged).toBe(false); // an empty survivor set never consults BetaTetris
  });
});
