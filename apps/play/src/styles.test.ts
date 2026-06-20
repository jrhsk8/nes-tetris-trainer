import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The global stylesheet, read from disk. */
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

describe('Site design (#19)', () => {
  it('uses the NES level-18 palette, cohesive with the board (#18)', () => {
    expect(css).toMatch(/#d82800/i); // NES red
    expect(css).toMatch(/#0058f8/i); // NES blue
    expect(css).toMatch(/#fcfcfc/i); // NES white
  });

  it('commits to the retro aesthetic: pixel font + CRT scanlines', () => {
    expect(css).toMatch(/Press Start 2P/i);
    expect(css).toMatch(/scanline|repeating-linear-gradient/i);
  });

  it('avoids the telltale generic-AI UI patterns', () => {
    // No glassmorphism.
    expect(css).not.toMatch(/backdrop-filter/i);
    // No purple/indigo gradient palette (the overused AI look).
    expect(css).not.toMatch(/#6366f1|#8b5cf6|#7c3aed|#a855f7|#818cf8|indigo|rebeccapurple/i);
    // Blocky, not rounded-everything: no large border radii.
    expect(css).not.toMatch(/border-radius:\s*(?:1[2-9]|[2-9]\d)px/i);
    expect(css).not.toMatch(/border-radius:\s*9999px|border-radius:\s*50%/i);
  });

  it('is actually wired into the app', () => {
    const main = readFileSync(fileURLToPath(new URL('./main.tsx', import.meta.url)), 'utf8');
    expect(main).toMatch(/styles\.css/);
  });
});
