import { describe, it, expect } from 'vitest';
import { PIECES, isPiece } from './index.js';

describe('@trainer/core', () => {
  it('exposes the seven tetrominoes', () => {
    expect(PIECES).toEqual(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
  });

  it('recognises valid piece names and rejects others', () => {
    expect(isPiece('T')).toBe(true);
    expect(isPiece('X')).toBe(false);
    expect(isPiece(42)).toBe(false);
  });
});
