// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyBoard, emptyColorGrid, restingCells, type Grid, type Placement } from '@trainer/core';
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

  it('colours filled cells by their colour group from the colour grid (#28)', () => {
    const grid: Grid = emptyBoard();
    const colorGrid = emptyColorGrid();
    grid[19][0] = 1;
    colorGrid[19][0] = 2; // Z/L group → $16 red
    grid[19][1] = 1;
    colorGrid[19][1] = 3; // J/S group → $12 blue
    grid[19][2] = 1; // no colour-grid entry → white fallback

    render(<Board grid={grid} colorGrid={colorGrid} />);

    expect(decodeURIComponent(screen.getByTestId('cell-19-0').style.backgroundImage)).toContain(
      '#d82800',
    );
    const blueCell = decodeURIComponent(screen.getByTestId('cell-19-1').style.backgroundImage);
    expect(blueCell).toContain('#0058f8');
    expect(blueCell).not.toContain('#d82800');
    // A filled cell with no colour-grid group falls back to the white sprite.
    const whiteCell = decodeURIComponent(screen.getByTestId('cell-19-2').style.backgroundImage);
    expect(whiteCell).not.toContain('#d82800');
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

    await user.click(screen.getByRole('button', { name: 'Rotate clockwise' }));
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

  it('rotates clockwise with x and counter-clockwise with z (inverses)', async () => {
    const user = userEvent.setup();
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    const input = screen.getByLabelText('placement input');
    await user.click(input);

    const start = input.getAttribute('data-rotation');
    await user.keyboard('x'); // CW
    expect(input.getAttribute('data-rotation')).not.toBe(start);
    await user.keyboard('z'); // CCW undoes it
    expect(input.getAttribute('data-rotation')).toBe(start);
  });

  it('honors a custom binding (Space confirms)', async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="L" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    await user.keyboard('[Space]');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reaches a tuck resting placement under an overhang and confirms it (#43)', async () => {
    const user = userEvent.setup();
    // A ledge across cols 4..7 at row 10. The pocket beneath (col 4, rows 16-19)
    // is reachable only by dropping down open col 3 and sliding right under the
    // ledge — a tuck the old column-only ghost could not express.
    const board = emptyBoard();
    for (let c = 4; c <= 7; c++) board[10][c] = 1;
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="I" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    await user.keyboard('{ArrowUp}'); // rotate the I to vertical (rotation 1) at col 3
    for (let i = 0; i < 20; i++) await user.keyboard('{ArrowDown}'); // soft-drop below the ledge
    await user.keyboard('{ArrowRight}'); // slide under the ledge into the pocket
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];

    // The emitted placement rests in the pocket UNDER the ledge — a genuine tuck,
    // not a straight drop onto the ledge, and what the ghost showed.
    const landed = restingCells(board, 'I', emitted)!;
    expect(landed).not.toBeNull();
    expect(keysOf(landed)).toEqual(new Set(['16-4', '17-4', '18-4', '19-4']));
    expect(keysOf(landed)).toEqual(ghostKeys());
  });
});
