// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyBoard, restingCells, type Grid, type Placement } from '@trainer/core';
import { Board } from './Board.js';
import { PlacementInput } from './PlacementInput.js';

/** The set of "row-col" keys currently rendered as ghost cells. */
function ghostKeys(): Set<string> {
  return new Set(
    Array.from(document.querySelectorAll('[data-state="ghost"]')).map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('cell-', ''),
    ),
  );
}

const keysOf = (cells: ReadonlyArray<readonly [number, number]>) =>
  new Set(cells.map(([r, c]) => `${r}-${c}`));

afterEach(() => cleanup());

describe('Board', () => {
  it('renders a 20x10 grid reflecting filled cells', () => {
    const grid: Grid = emptyBoard();
    grid[19][0] = 1;
    render(<Board grid={grid} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(200);
    expect(screen.getByTestId('cell-19-0')).toHaveAttribute('data-state', 'filled');
    expect(screen.getByTestId('cell-0-0')).toHaveAttribute('data-state', 'empty');
  });

  it('draws ghost cells where asked', () => {
    render(<Board grid={emptyBoard()} ghostCells={[[18, 4]]} />);
    expect(screen.getByTestId('cell-18-4')).toHaveAttribute('data-state', 'ghost');
  });

  it('renders filled cells as crisp NES block sprites, not flat squares (#18)', () => {
    const grid: Grid = emptyBoard();
    grid[19][0] = 1;
    render(<Board grid={grid} />);
    const filled = screen.getByTestId('cell-19-0');
    const bg = decodeURIComponent(filled.style.backgroundImage);
    expect(bg).toContain('data:image/svg+xml');
    expect(bg).toContain('shape-rendering="crispEdges"');
  });

  it('colours the ghost in its piece colour (Z → $16 red) (#18)', () => {
    render(<Board grid={emptyBoard()} ghostCells={[[18, 4]]} ghostPiece="Z" />);
    const ghost = screen.getByTestId('cell-18-4');
    expect(decodeURIComponent(ghost.style.backgroundImage)).toContain('#d82800');
  });
});

describe('PlacementInput', () => {
  it('shows a ghost at the resting position from the start', () => {
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    // The ghost must equal a real resting placement of the T on the board.
    const shown = ghostKeys();
    expect(shown.size).toBe(4);
  });

  it('moves and rotates the ghost, then emits the placement that was shown', async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="T" onConfirm={onConfirm} />);

    const before = ghostKeys();
    await user.click(screen.getByRole('button', { name: 'Move right' }));
    const afterMove = ghostKeys();
    expect(afterMove).not.toEqual(before); // the ghost actually moved

    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    const shownAtConfirm = ghostKeys();

    await user.click(screen.getByRole('button', { name: 'Confirm placement' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];

    // The emitted placement, dropped on the same board, lands exactly where the
    // ghost was shown — what you saw is what you get.
    const landed = restingCells(board, 'T', emitted);
    expect(landed).not.toBeNull();
    expect(keysOf(landed!)).toEqual(shownAtConfirm);
  });

  it('supports keyboard control (arrows + enter)', async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="L" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    await user.keyboard('{ArrowLeft}{ArrowUp}{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];
    expect(keysOf(restingCells(board, 'L', emitted)!)).toEqual(ghostKeys());
  });
});
