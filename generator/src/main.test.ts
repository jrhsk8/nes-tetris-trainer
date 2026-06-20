import { describe, it, expect } from 'vitest';
import { PIECES, isPiece } from '@trainer/core';

// Proves the generator workspace resolves the shared core package.
describe('@trainer/generator ↔ @trainer/core', () => {
  it('imports shared puzzle logic from core', () => {
    expect(PIECES).toHaveLength(7);
    expect(isPiece('I')).toBe(true);
  });
});
