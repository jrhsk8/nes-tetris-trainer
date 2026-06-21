import { describe, it, expect } from 'vitest';
import { parsePuzzleParam, puzzleShareUrl, PUZZLE_PARAM } from './share.js';

describe('puzzleShareUrl (#49)', () => {
  it('builds a ?puzzle=N link under the deployed base path', () => {
    const url = puzzleShareUrl(123, 'https://jrhsk8.github.io', '/nes-tetris-trainer/');
    expect(url).toBe('https://jrhsk8.github.io/nes-tetris-trainer/?puzzle=123');
  });

  it('round-trips through parsePuzzleParam', () => {
    const url = puzzleShareUrl(42, 'https://x.example', '/base/');
    const search = url.slice(url.indexOf('?'));
    expect(parsePuzzleParam(search)).toBe(42);
  });
});

describe('parsePuzzleParam (#49)', () => {
  it('reads a valid positive integer', () => {
    expect(parsePuzzleParam(`?${PUZZLE_PARAM}=7`)).toBe(7);
    expect(parsePuzzleParam('?foo=1&puzzle=309')).toBe(309);
  });

  it('falls back to null for a missing or malformed param', () => {
    expect(parsePuzzleParam('')).toBeNull();
    expect(parsePuzzleParam('?other=5')).toBeNull();
    expect(parsePuzzleParam('?puzzle=')).toBeNull();
    expect(parsePuzzleParam('?puzzle=abc')).toBeNull();
    expect(parsePuzzleParam('?puzzle=12x')).toBeNull();
    expect(parsePuzzleParam('?puzzle=0')).toBeNull();
    expect(parsePuzzleParam('?puzzle=-3')).toBeNull();
  });
});
