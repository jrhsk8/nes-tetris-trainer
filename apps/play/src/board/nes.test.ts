import { describe, it, expect } from 'vitest';
import { PIECE_GROUP, LEVEL18_PALETTE, blockBackground, pieceBackground } from './nes.js';

/** Decode the SVG out of a `url("data:image/svg+xml,…")` background value. */
function svgOf(background: string): string {
  const match = background.match(/data:image\/svg\+xml,([^"]+)/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]);
}

describe('NES level-18 palette (#18)', () => {
  it('groups pieces the way the NES does: T/O/I white, Z/L, J/S', () => {
    expect(PIECE_GROUP).toMatchObject({ T: 1, O: 1, I: 1, Z: 2, L: 2, J: 3, S: 3 });
  });

  it('uses the level-18 colours (black, white, $16 red, $12 blue)', () => {
    expect(LEVEL18_PALETTE).toEqual(['#000000', '#fcfcfc', '#d82800', '#0058f8']);
  });

  it('renders blocks as crisp, non-anti-aliased pixel sprites', () => {
    const svg = svgOf(blockBackground(1));
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('viewBox="0 0 8 8"');
    expect(svg).toContain('<rect');
  });

  it('draws the white-group block with a white fill and coloured frame', () => {
    const svg = svgOf(blockBackground(1));
    expect(svg).toContain('#fcfcfc'); // white interior
    expect(svg).toContain('#0058f8'); // $12 frame
    expect(svg).not.toContain('#d82800'); // no $16 in the white block
  });

  it('colours Z/L blocks with $16 and J/S blocks with $12, both with a white shine', () => {
    const z = svgOf(pieceBackground('Z'));
    expect(z).toContain('#d82800');
    expect(z).toContain('#fcfcfc'); // shine

    const j = svgOf(pieceBackground('J'));
    expect(j).toContain('#0058f8');
    expect(j).toContain('#fcfcfc');
  });
});
