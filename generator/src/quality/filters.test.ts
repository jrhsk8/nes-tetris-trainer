import { describe, it, expect } from 'vitest';
import {
  isUnambiguous,
  isHzInvariant,
  movesEqual,
  DEFAULT_UNAMBIGUITY_THRESHOLD,
} from './filters.js';

describe('isUnambiguous', () => {
  const threshold = 5;

  it('keeps a candidate whose margin exceeds the threshold', () => {
    expect(isUnambiguous(20, 10, threshold)).toBe(true);
  });

  it('treats a margin exactly at the threshold as unambiguous (boundary)', () => {
    expect(isUnambiguous(15, 10, threshold)).toBe(true);
  });

  it('rejects a candidate whose margin is just below the threshold', () => {
    expect(isUnambiguous(14.999, 10, threshold)).toBe(false);
  });

  it('rejects ties and negative margins', () => {
    expect(isUnambiguous(10, 10, threshold)).toBe(false);
    expect(isUnambiguous(8, 10, threshold)).toBe(false);
  });

  it('handles negative engine values by comparing the margin, not the sign', () => {
    // Eval scores are routinely negative; only the gap matters.
    expect(isUnambiguous(-1, -10, threshold)).toBe(true);
    expect(isUnambiguous(-8, -10, threshold)).toBe(false);
  });

  it('never treats a non-finite value as unambiguous', () => {
    expect(isUnambiguous(Number.NaN, 0, threshold)).toBe(false);
    expect(isUnambiguous(10, Number.NaN, threshold)).toBe(false);
  });

  it('exposes a finite, positive default threshold', () => {
    expect(Number.isFinite(DEFAULT_UNAMBIGUITY_THRESHOLD)).toBe(true);
    expect(DEFAULT_UNAMBIGUITY_THRESHOLD).toBeGreaterThan(0);
  });
});

describe('movesEqual', () => {
  it('compares rotation and column', () => {
    expect(movesEqual({ rotation: 1, x: 3 }, { rotation: 1, x: 3 })).toBe(true);
    expect(movesEqual({ rotation: 1, x: 3 }, { rotation: 2, x: 3 })).toBe(false);
    expect(movesEqual({ rotation: 1, x: 3 }, { rotation: 1, x: 4 })).toBe(false);
  });
});

describe('isHzInvariant', () => {
  it('keeps a candidate whose optimal move agrees across timelines', () => {
    expect(
      isHzInvariant([
        { rotation: 2, x: -1 },
        { rotation: 2, x: -1 },
      ]),
    ).toBe(true);
  });

  it('rejects a candidate whose optimal move differs across timelines', () => {
    expect(
      isHzInvariant([
        { rotation: 2, x: -1 },
        { rotation: 2, x: 0 }, // fast-DAS lands a column over
      ]),
    ).toBe(false);
  });

  it('requires agreement across all (3+) timelines, not just the first pair', () => {
    expect(
      isHzInvariant([
        { rotation: 0, x: 2 },
        { rotation: 0, x: 2 },
        { rotation: 1, x: 2 },
      ]),
    ).toBe(false);
  });

  it('treats a single timeline as trivially invariant', () => {
    expect(isHzInvariant([{ rotation: 0, x: 0 }])).toBe(true);
  });

  it('treats an empty list as not invariant (nothing confirmed)', () => {
    expect(isHzInvariant([])).toBe(false);
  });
});
