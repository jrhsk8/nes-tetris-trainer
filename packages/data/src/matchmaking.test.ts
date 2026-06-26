import { describe, it, expect } from 'vitest';
import { boardMetrics, emptyBoard, encodeBoard, type PuzzleTag } from '@trainer/core';
import { selectMatchmadePuzzle, distinctRecent } from './matchmaking.js';
import type { Puzzle } from './types.js';

/** A puzzle stub carrying just an id, rating, and (for #99) type-tags. */
function puzzleAt(id: string, rating: number, tags: PuzzleTag[] = []): Puzzle {
  const board = encodeBoard(emptyBoard());
  return {
    id,
    number: 1,
    board,
    piece1: 'T',
    piece2: 'L',
    optimalLine: [
      { rotation: 0, col: 0 },
      { rotation: 0, col: 3 },
    ],
    optimalMetrics: boardMetrics(emptyBoard()),
    glicko: { rating, deviation: 350, volatility: 0.06 },
    colors: '',
    combos: { entries: [], total: 0 },
    tags,
    acceptCount: null,
    margin: null,
    firstValues: [],
    secondValues: [],
  };
}

/** Builds a fetcher over a fixed bank that records the band bounds it was asked for. */
function bankFetcher(bank: Puzzle[]) {
  const calls: { min: number; max: number }[] = [];
  const fetch = async (min: number, max: number): Promise<Puzzle[]> => {
    calls.push({ min, max });
    return bank.filter((p) => p.glicko.rating >= min && p.glicko.rating <= max);
  };
  return { fetch, calls };
}

describe('selectMatchmadePuzzle (#44)', () => {
  const bank = [
    puzzleAt('low', 1000),
    puzzleAt('near-a', 1480),
    puzzleAt('near-b', 1520),
    puzzleAt('high', 2000),
  ];

  it('picks a puzzle within the band around the player', async () => {
    const { fetch } = bankFetcher(bank);
    // band 100 around 1500 → [1400, 1600] → only near-a / near-b qualify.
    const picked = await selectMatchmadePuzzle(fetch, {
      rating: 1500,
      band: 100,
      random: () => 0, // first candidate
    });
    expect(picked).not.toBeNull();
    expect(['near-a', 'near-b']).toContain(picked!.id);
    expect(Math.abs(picked!.glicko.rating - 1500)).toBeLessThanOrEqual(100);
  });

  it('widens the band when too few puzzles are in range', async () => {
    // Player far from the cluster: nothing within ±100 of 1750, so it must widen.
    const { fetch, calls } = bankFetcher(bank);
    const picked = await selectMatchmadePuzzle(fetch, {
      rating: 1750,
      band: 100,
      random: () => 0,
    });
    expect(picked).not.toBeNull();
    // Widened past the initial ±100 (at least one re-query at a larger band).
    expect(calls.length).toBeGreaterThan(1);
    const widest = calls[calls.length - 1];
    expect(widest.max - widest.min).toBeGreaterThan(200);
  });

  it('returns null only when no puzzle exists in range even at the widest band', async () => {
    const { fetch } = bankFetcher([]);
    const picked = await selectMatchmadePuzzle(fetch, { rating: 1500 });
    expect(picked).toBeNull();
  });

  it('excludes a recently-seen puzzle until the cooldown lapses', async () => {
    // Two in-band puzzles; with near-a on cooldown only near-b can be picked,
    // regardless of the RNG draw.
    const { fetch } = bankFetcher(bank);
    for (const r of [0, 0.5, 0.99]) {
      const picked = await selectMatchmadePuzzle(fetch, {
        rating: 1500,
        band: 100,
        recentIds: ['near-a'],
        random: () => r,
      });
      expect(picked!.id).toBe('near-b');
    }

    // Once the cooldown lapses (near-a no longer excluded), it is selectable again.
    const seenAgain = new Set<string>();
    for (const r of [0, 0.99]) {
      const picked = await selectMatchmadePuzzle(fetch, {
        rating: 1500,
        band: 100,
        random: () => r,
      });
      seenAgain.add(picked!.id);
    }
    expect(seenAgain).toContain('near-a');
  });

  it('relaxes the cooldown as a last resort when everything in range is on cooldown', async () => {
    const { fetch } = bankFetcher(bank);
    const picked = await selectMatchmadePuzzle(fetch, {
      rating: 1500,
      band: 100,
      maxBand: 100,
      recentIds: ['near-a', 'near-b'],
      random: () => 0,
    });
    expect(picked).not.toBeNull();
    expect(['near-a', 'near-b']).toContain(picked!.id);
  });
});

describe('anti-streak de-clustering by type (#99)', () => {
  // Three in-band puzzles around 1500: two tucks and one spin.
  const typedBank = [
    puzzleAt('tuck-a', 1480, ['tuck']),
    puzzleAt('tuck-b', 1520, ['tuck', 'clean-stacking']),
    puzzleAt('spin-c', 1500, ['spin']),
  ];

  it('down-weights a just-served type so a different type is favored', async () => {
    const { fetch } = bankFetcher(typedBank);
    // Last two serves were tucks: the two tucks are penalized (0.35² each), the
    // spin keeps weight 1, so the mid-RNG draw lands in the spin's larger mass.
    const declustered = await selectMatchmadePuzzle(fetch, {
      rating: 1500,
      band: 100,
      recentTags: ['tuck', 'tuck'],
      random: () => 0.5,
    });
    expect(declustered!.id).toBe('spin-c');

    // The SAME RNG with no recent-type history is a plain uniform pick — proving
    // it is the weighting, not the RNG, that changed the outcome.
    const uniform = await selectMatchmadePuzzle(fetch, {
      rating: 1500,
      band: 100,
      random: () => 0.5,
    });
    expect(uniform!.id).toBe('tuck-b'); // floor(0.5 * 3) = index 1
  });

  it('still serves a type when the whole band is that type (never starves)', async () => {
    const allTucks = [puzzleAt('t1', 1490, ['tuck']), puzzleAt('t2', 1510, ['tuck'])];
    const { fetch } = bankFetcher(allTucks);
    for (const r of [0, 0.5, 0.99]) {
      const picked = await selectMatchmadePuzzle(fetch, {
        rating: 1500,
        band: 100,
        recentTags: ['tuck', 'tuck', 'tuck'],
        random: () => r,
      });
      expect(['t1', 't2']).toContain(picked!.id);
    }
  });

  it('is a plain uniform pick when no recent types are supplied', async () => {
    const { fetch } = bankFetcher(typedBank);
    const picked = await selectMatchmadePuzzle(fetch, {
      rating: 1500,
      band: 100,
      random: () => 0.5,
    });
    expect(picked!.id).toBe('tuck-b'); // floor(0.5 * 3) = index 1, unweighted
  });

  it('reads a multi-tag puzzle by its headline type (a spin+tuck reads as spin)', async () => {
    // dominantTag prioritizes the maneuver; a ['tuck','spin'] puzzle reads as a
    // spin here, distinct from a plain tuck, so a tuck streak does not suppress it.
    const mixed = [
      puzzleAt('plain-tuck', 1490, ['tuck']),
      puzzleAt('spin-piece', 1510, ['spin', 'tuck']),
    ];
    const { fetch } = bankFetcher(mixed);
    const picked = await selectMatchmadePuzzle(fetch, {
      rating: 1500,
      band: 100,
      recentTags: ['tuck', 'tuck'],
      random: () => 0.5,
    });
    // plain-tuck penalized (0.35²≈0.1225), spin-piece weight 1 → mid draw → spin.
    expect(picked!.id).toBe('spin-piece');
  });
});

describe('distinctRecent (200-window derivation, #74)', () => {
  it('keeps the most-recent distinct ids in newest-first order', () => {
    // Newest-first attempt stream with repeats: a re-attempt of an older
    // puzzle surfaces it at its newest position, deduped.
    const stream = ['a', 'b', 'a', 'c', 'b', 'd'];
    expect(distinctRecent(stream, 200)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('caps the window at the limit (oldest distinct ids fall out)', () => {
    const stream = ['a', 'b', 'c', 'd', 'e'];
    expect(distinctRecent(stream, 3)).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic for the same input (a reload yields the same window)', () => {
    const stream = ['p3', 'p3', 'p1', 'p2', 'p1'];
    const first = distinctRecent(stream, 200);
    const second = distinctRecent(stream, 200);
    expect(second).toEqual(first);
    expect(first).toEqual(['p3', 'p1', 'p2']);
  });
});
