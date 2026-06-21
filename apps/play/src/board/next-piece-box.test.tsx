/**
 * NES-style next-piece box (#23) — renders the next piece as the real NES block
 * graphic (spawn orientation, its colour group), with the piece letter kept as
 * an accessible label so the existing flow tests still find it.
 */

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextPieceBox } from './NextPieceBox.js';
import { blockBackground, PIECE_GROUP } from './nes.js';

afterEach(cleanup);

describe('NextPieceBox', () => {
  it('renders the piece as four NES block cells in its colour group', () => {
    render(<NextPieceBox piece="T" />);
    const filled = screen.getAllByTestId('next-filled');
    expect(filled).toHaveLength(4);
    for (const cell of filled) {
      expect(cell.style.backgroundImage).toBe(blockBackground(PIECE_GROUP.T));
    }
  });

  it('colours each piece by its own NES group', () => {
    render(<NextPieceBox piece="Z" />);
    const filled = screen.getAllByTestId('next-filled');
    for (const cell of filled) {
      expect(cell.style.backgroundImage).toBe(blockBackground(PIECE_GROUP.Z));
    }
  });

  it('keeps the piece letter available accessibly', () => {
    render(<NextPieceBox piece="L" />);
    expect(screen.getByTestId('next-piece')).toHaveTextContent('L');
  });

  it('renders no piece graphic during placement 2 (no lookahead)', () => {
    render(<NextPieceBox piece={null} />);
    expect(screen.queryByTestId('next-piece')).toBeNull();
    expect(screen.queryAllByTestId('next-filled')).toHaveLength(0);
  });
});
