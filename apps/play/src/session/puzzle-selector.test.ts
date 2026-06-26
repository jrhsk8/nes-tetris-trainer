import { describe, it, expect } from 'vitest';
import { boardMetrics, emptyBoard, encodeBoard, type PuzzleTag } from '@trainer/core';
import type { Puzzle } from '@trainer/data';
import {
  selectNextPuzzle,
  initialSelectionState,
  type SelectorDb,
  type SelectionConfig,
} from './puzzle-selector.js';

/** A puzzle stub carrying just an id and (for the anti-streak window) type-tags. */
function pz(id: string, tags: PuzzleTag[] = []): Puzzle {
  return {
    id,
    number: 1,
    board: encodeBoard(emptyBoard()),
    piece1: 'T',
    piece2: 'L',
    optimalLine: [
      { rotation: 0, col: 0 },
      { rotation: 0, col: 3 },
    ],
    optimalMetrics: boardMetrics(emptyBoard()),
    glicko: { rating: 1500, deviation: 350, volatility: 0.06 },
    colors: '',
    combos: { entries: [], total: 0 },
    tags,
    acceptCount: null,
    margin: null,
    firstValues: [],
    secondValues: [],
  };
}

interface FakeOptions {
  byNumber?: Record<number, Puzzle>;
  tagPool?: Puzzle[];
  matchmade?: Puzzle | null;
  misses?: string[];
  recent?: string[];
  rating?: number;
}

/** A configurable {@link SelectorDb} that records the matchmaking calls it gets. */
function fakeDb(opts: FakeOptions = {}) {
  const matchmakeCalls: {
    rating: number;
    recentIds: readonly string[];
    recentTags?: readonly string[];
  }[] = [];
  const db: SelectorDb = {
    async getPuzzleByNumber(n) {
      return opts.byNumber?.[n] ?? null;
    },
    async fetchPuzzlesByTags(_tags, o) {
      const exclude = new Set(o?.excludeIds ?? []);
      return (opts.tagPool ?? []).filter((p) => !exclude.has(p.id));
    },
    async getMatchmadePuzzle(o) {
      matchmakeCalls.push({ rating: o.rating, recentIds: o.recentIds ?? [], recentTags: o.recentTags });
      return opts.matchmade ?? null;
    },
    async getPuzzle(id) {
      return pz(id);
    },
    async getRecentAttemptedPuzzleIds() {
      return opts.recent ?? [];
    },
    async getMissPuzzleIds() {
      return opts.misses ?? [];
    },
    async getUserRating() {
      return opts.rating != null
        ? { userId: 'u', rating: opts.rating, deviation: 350, volatility: 0.06 }
        : null;
    },
  };
  return { db, matchmakeCalls };
}

const base: SelectionConfig = { userId: 'u', reviewMode: false };

describe('selectNextPuzzle', () => {
  it('opens the shared ?puzzle=N first, then returns to matchmaking', async () => {
    const { db, matchmakeCalls } = fakeDb({ byNumber: { 5: pz('shared') }, matchmade: pz('mm') });
    const state = initialSelectionState(5);

    expect((await selectNextPuzzle(db, base, state))?.id).toBe('shared');
    expect(matchmakeCalls).toHaveLength(0); // the shared open bypassed matchmaking
    expect((await selectNextPuzzle(db, base, state))?.id).toBe('mm'); // one-shot consumed
    expect(matchmakeCalls).toHaveLength(1);
  });

  it('drill walks the tag pool without repeats, cycles, and never touches the window', async () => {
    const { db, matchmakeCalls } = fakeDb({ tagPool: [pz('a', ['tuck']), pz('b', ['tuck'])] });
    const cfg: SelectionConfig = { userId: 'u', reviewMode: false, drillTags: ['tuck'] };
    const state = initialSelectionState();

    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('a');
    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('b');
    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('a'); // exhausted ⇒ cycled
    expect(matchmakeCalls).toHaveLength(0);
    expect(state.recent).toEqual([]); // drill bypasses the anti-repeat + anti-streak windows
    expect(state.recentTags).toEqual([]);
  });

  it('review-misses serves misses oldest-first and cycles, bypassing the rating band', async () => {
    const { db, matchmakeCalls } = fakeDb({ misses: ['m1', 'm2', 'm3'] });
    const cfg: SelectionConfig = { userId: 'u', reviewMode: true };
    const state = initialSelectionState();

    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('m1');
    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('m2');
    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('m3');
    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('m1'); // all served ⇒ cycled
    expect(matchmakeCalls).toHaveLength(0);
  });

  it('normal play injects the oldest DUE miss when the rate gate fires', async () => {
    const { db, matchmakeCalls } = fakeDb({ misses: ['m1'], recent: [], matchmade: pz('mm') });
    // random 0 < MISS_INJECT_RATE (0.1) ⇒ inject; m1 is due (not in the window).
    const cfg: SelectionConfig = { userId: 'u', reviewMode: false, random: () => 0 };
    const state = initialSelectionState();

    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('m1');
    expect(matchmakeCalls).toHaveLength(0); // injected instead of matchmaking
  });

  it('matchmaking excludes the anti-repeat window and records each serve in both windows', async () => {
    const { db, matchmakeCalls } = fakeDb({
      misses: [],
      recent: ['old1', 'old2'],
      matchmade: pz('fresh', ['t-spin']),
      rating: 1700,
    });
    // random ≥ 0.1 ⇒ no miss injection, so the matchmaker is consulted.
    const cfg: SelectionConfig = { userId: 'u', reviewMode: false, random: () => 0.99 };
    const state = initialSelectionState();

    expect((await selectNextPuzzle(db, cfg, state))?.id).toBe('fresh');
    expect(matchmakeCalls).toHaveLength(1);
    expect(matchmakeCalls[0].rating).toBe(1700);
    expect(matchmakeCalls[0].recentIds).toEqual(['old1', 'old2']); // window hydrated + excluded
    expect(state.recent[0]).toBe('fresh'); // the serve heads the anti-repeat window
    expect(state.recentTags[0]).toBe('t-spin'); // …and the anti-streak window, by headline type
  });
});
