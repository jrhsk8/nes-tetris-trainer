import { describe, it, expect } from 'vitest';
import { PIECES } from '@trainer/core';

// Proves the play app workspace resolves the shared core package.
describe('@trainer/play ↔ @trainer/core', () => {
  it('imports shared puzzle logic from core', () => {
    expect(PIECES).toContain('T');
  });
});
