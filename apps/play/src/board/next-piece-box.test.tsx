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

  // The footprint is 2 rows × 4 cols; a filled cell carries data-cell="row-col".
  const filledCells = () =>
    screen.getAllByTestId('next-filled').map((el) => el.getAttribute('data-cell')).sort();

  it('shows pieces in their true NES next-box orientations', () => {
    // T like the letter T (3-bar on top, stem down-centre).
    cleanup();
    render(<NextPieceBox piece="T" />);
    expect(filledCells()).toEqual(['0-0', '0-1', '0-2', '1-1']);

    // J points down (3-bar on top, foot down-right).
    cleanup();
    render(<NextPieceBox piece="J" />);
    expect(filledCells()).toEqual(['0-0', '0-1', '0-2', '1-2']);

    // L points down (3-bar on top, foot down-left).
    cleanup();
    render(<NextPieceBox piece="L" />);
    expect(filledCells()).toEqual(['0-0', '0-1', '0-2', '1-0']);

    // I bar lies flat.
    cleanup();
    render(<NextPieceBox piece="I" />);
    expect(filledCells()).toEqual(['0-0', '0-1', '0-2', '0-3']);

    // S lies flat.
    cleanup();
    render(<NextPieceBox piece="S" />);
    expect(filledCells()).toEqual(['0-1', '0-2', '1-0', '1-1']);

    // Z lies flat.
    cleanup();
    render(<NextPieceBox piece="Z" />);
    expect(filledCells()).toEqual(['0-0', '0-1', '1-1', '1-2']);
  });
});
