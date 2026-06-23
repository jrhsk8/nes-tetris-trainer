// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyBoard, emptyColorGrid, restingCells, type Grid, type Placement } from '@trainer/core';
import { Board } from './Board.js';
import { PlacementInput } from './PlacementInput.js';

/** The set of "row-col" keys currently rendered in `state`. */
function cellsInState(state: string): Set<string> {
  return new Set(
    Array.from(document.querySelectorAll(`[data-state="${state}"]`)).map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('cell-', ''),
    ),
  );
}

/** The set of "row-col" keys currently rendered as the drop-shadow (ghost) cells. */
function ghostKeys(): Set<string> {
  return cellsInState('ghost');
}

/**
 * Where the piece visibly lands (#81): the drop-shadow when the piece floats
 * above its landing, or the bright active piece itself when it rests AT the
 * landing (then it occludes its own shadow). This is the WYSIWYG target a
 * confirmed placement must equal.
 */
function landingKeys(): Set<string> {
  const ghost = ghostKeys();
  return ghost.size ? ghost : cellsInState('active');
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

  it('draws the positioning ghost as a muted-fill preview (no outline), distinct from a locked cell and the gold highlight (#48, #57)', () => {
    const grid: Grid = emptyBoard();
    grid[19][0] = 1; // a locked cell
    render(
      <Board
        grid={grid}
        ghostCells={[[18, 4]]}
        ghostPiece="Z"
        highlightCells={[[17, 4]]}
        highlightPiece="Z"
      />,
    );
    const ghost = screen.getByTestId('cell-18-4');
    const locked = screen.getByTestId('cell-19-0');
    const highlight = screen.getByTestId('cell-17-4');

    // The ghost reads as a movable preview via a muted (washed-down) fill alone —
    // the dashed outline was dropped (#57); the opacity wash carries the read.
    expect(ghost.style.outline).toBe('');
    expect(ghost.style.backgroundImage).toContain('linear-gradient');
    // It is still distinct from a locked cell (solid sprite, no wash)...
    expect(locked.style.backgroundImage).not.toContain('linear-gradient');
    // ...and from the feedback highlight's solid gold inset outline.
    expect(ghost.style.boxShadow).not.toContain('#fcd000');
    expect(highlight.style.boxShadow).toContain('#fcd000');
    expect(highlight.style.outline).toBe('');
  });

  it('never draws a cell outside the grid, even given out-of-bounds cells (#58 guard)', () => {
    // Belt-and-suspenders: the reachability model already proves no piece reaches
    // past col 9 (placement.test.ts), but Board must never render OOB even if fed
    // anomalous data. Past the right wall (col 10), the left wall (col -1), and
    // below the floor (row 20) are all silently dropped.
    render(
      <Board
        grid={emptyBoard()}
        ghostCells={[
          [5, 10], // past the right wall
          [5, -1], // past the left wall
          [20, 0], // below the floor
        ]}
        highlightCells={[[5, 99]]}
      />,
    );
    // Exactly the 200 on-board cells, none more.
    expect(screen.getAllByRole('gridcell')).toHaveLength(200);
    expect(screen.queryByTestId('cell-5-10')).toBeNull();
    expect(screen.queryByTestId('cell-5--1')).toBeNull();
    expect(screen.queryByTestId('cell-20-0')).toBeNull();
    // ...and no on-board cell was mistakenly painted by the OOB input.
    expect(ghostKeys().size).toBe(0);
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

  it('auto-focuses the board on load so the loop is no-mouse (#64)', () => {
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    // No click needed — keystrokes land on the placement input immediately.
    expect(screen.getByLabelText('placement input')).toHaveFocus();
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
    const shownAtConfirm = landingKeys();

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
    // ArrowLeft shifts + settles, ArrowUp lifts one row (so the active piece now
    // floats just above its landing, partially over the drop-shadow).
    await user.keyboard('{ArrowLeft}{ArrowUp}{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];
    // What you confirm is what's shown: every cell of the landing is visibly drawn
    // — as the drop-shadow, or (where the lifted piece overlaps it) as the active
    // piece itself.
    const shown = new Set([...ghostKeys(), ...cellsInState('active')]);
    const landed = keysOf(restingCells(board, 'L', emitted)!);
    expect([...landed].every((k) => shown.has(k))).toBe(true);
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
    await user.keyboard('x'); // rotate the I to vertical (rotation 1) at col 3
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
    expect(keysOf(landed)).toEqual(landingKeys());
  });

  it('a settled piece slides onto a higher neighbour by riding up its surface (#81)', async () => {
    const user = userEvent.setup();
    // A tall wall fills col 9 from row 8 down; col 8 is an open well. Soft-drop a
    // vertical I to the floor of col 8, then press RIGHT toward the wall. The piece
    // is settled LOW, so it cannot translate across at that row — instead it rides
    // UP the wall's surface and rests ON TOP of it (rows 4..7). This is the owner's
    // "a dropped piece should still slide left/right easily" fix: a single press
    // climbs onto the neighbour rather than stalling against it.
    const board = emptyBoard();
    for (let r = 8; r < 20; r++) board[r][9] = 1;
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="I" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    await user.keyboard('x'); // vertical I
    for (let i = 0; i < 5; i++) await user.keyboard('{ArrowRight}'); // walk to col 8 well
    for (let i = 0; i < 20; i++) await user.keyboard('{ArrowDown}'); // soft-drop to the floor
    await user.keyboard('{ArrowRight}'); // press toward the wall — rides up onto it
    expect(landingKeys()).toEqual(new Set(['4-9', '5-9', '6-9', '7-9']));
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const landed = restingCells(board, 'I', onConfirm.mock.calls[0][0])!;
    // Seated on top of the wall, reached by a single lateral press.
    expect(keysOf(landed)).toEqual(new Set(['4-9', '5-9', '6-9', '7-9']));
    expect(keysOf(landed)).toEqual(landingKeys());
  });

  it('slides freely both ways: rides up onto a wall, then back down into the well (#81)', async () => {
    const user = userEvent.setup();
    // col-9 wall (rows 8-19), col-8 well. From the well floor, RIGHT rides up onto
    // the wall (rows 4..7); LEFT then slides straight back off it and falls into
    // the col-8 well (rows 16..19). A settled piece moves freely in both directions
    // with single presses — never stuck against the bump.
    const board = emptyBoard();
    for (let r = 8; r < 20; r++) board[r][9] = 1;
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="I" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    await user.keyboard('x'); // vertical I
    for (let i = 0; i < 5; i++) await user.keyboard('{ArrowRight}'); // walk to col 8 well
    for (let i = 0; i < 20; i++) await user.keyboard('{ArrowDown}'); // soft-drop to the floor
    await user.keyboard('{ArrowRight}'); // ride up onto the wall
    expect(landingKeys()).toEqual(new Set(['4-9', '5-9', '6-9', '7-9']));
    await user.keyboard('{ArrowLeft}'); // slide back off — falls into the well
    expect(landingKeys()).toEqual(new Set(['16-8', '17-8', '18-8', '19-8']));
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const landed = restingCells(board, 'I', onConfirm.mock.calls[0][0])!;
    expect(keysOf(landed)).toEqual(new Set(['16-8', '17-8', '18-8', '19-8']));
  });

  // jsdom has no PointerEvent (and drops clientX from a synthetic one). A
  // MouseEvent typed as a pointer event carries clientX/button and fires the
  // React onPointer* handlers, so it stands in for a finger drag here.
  const ptr = (type: string, clientX: number) =>
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
  const mockGrid = (container: HTMLElement) => {
    const gridEl = container.querySelector('.board') as HTMLElement;
    gridEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 320, height: 640, right: 320, bottom: 640, x: 0, y: 0 }) as DOMRect;
  };

  it('positions the piece by dragging on the board, committing only on Confirm (#69)', async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    const onConfirm = vi.fn<(p: Placement) => void>();
    const { container } = render(
      <PlacementInput board={board} piece="O" onConfirm={onConfirm} />,
    );
    mockGrid(container); // 10 columns × 32px starting at x=0

    const surface = screen.getByLabelText('board drag surface');
    // Drag to near the right wall (x≈300 → finger col 9). The O (2 wide) centers
    // there and clamps to col 8 (cols 8,9), resting on the floor (rows 18,19).
    fireEvent(surface, ptr('pointerdown', 300));
    fireEvent(surface, ptr('pointermove', 300));

    // Lift-to-place must NOT commit — only the explicit Confirm button does.
    fireEvent(surface, ptr('pointerup', 300));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm placement' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const landed = restingCells(board, 'O', onConfirm.mock.calls[0][0])!;
    expect(keysOf(landed)).toEqual(new Set(['18-8', '18-9', '19-8', '19-9']));
    expect(keysOf(landed)).toEqual(landingKeys());
  });

  it('drag positions against a wall by the same shift-then-settle rule as L/R (#69, #81)', () => {
    const board = emptyBoard();
    for (let r = 8; r < 20; r++) board[r][9] = 1; // wall in col 9
    const onConfirm = vi.fn<(p: Placement) => void>();
    const { container } = render(
      <PlacementInput board={board} piece="I" onConfirm={onConfirm} />,
    );
    mockGrid(container);

    const surface = screen.getByLabelText('board drag surface');
    // Drag the horizontal I toward the wall column — it walks over and the piece
    // settles ON top of the wall (right end on col 9 at row 7), never off-board,
    // never below the wall.
    fireEvent(surface, ptr('pointerdown', 315));

    const landing = landingKeys();
    expect([...landing].every((k) => Number(k.split('-')[0]) <= 7)).toBe(true);
    expect(landing.has('7-9')).toBe(true);
  });

  it('a board drag only moves while the pointer is down, not after release (#69)', () => {
    const board = emptyBoard();
    const { container } = render(<PlacementInput board={board} piece="O" onConfirm={vi.fn()} />);
    mockGrid(container);
    const surface = screen.getByLabelText('board drag surface');

    fireEvent(surface, ptr('pointerdown', 30)); // left side
    const afterLeft = ghostKeys();
    fireEvent(surface, ptr('pointerup', 30));
    fireEvent(surface, ptr('pointermove', 300)); // move after release — ignored
    expect(ghostKeys()).toEqual(afterLeft);
  });

  it('recovers from a soft-drop overshoot by raising back up to seat a tuck/spin (#56)', async () => {
    const user = userEvent.setup();
    // An overhang caps col 2 at row 11; a shelf at row 16 floors a 4-tall pocket
    // (col 2, rows 12-15) UNDER the overhang. The only way in is to soft-drop the
    // vertical I down the open col-3 well to floating row 12 and slide left — one
    // row too far (row 13+) and col 2 is blocked, so the piece can't seat. Before
    // #56 soft-drop was irreversible: overshoot stranded the piece on the floor.
    const board = emptyBoard();
    board[11][2] = 1; // overhang over the pocket
    board[16][2] = 1; // shelf the tuck rests on
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="I" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    await user.keyboard('x'); // rotate the I to vertical (rotation 1) at col 3
    for (let i = 0; i < 20; i++) await user.keyboard('{ArrowDown}'); // OVERSHOOT to the floor
    for (let i = 0; i < 4; i++) await user.keyboard('{ArrowUp}'); // raise back up to the tuck row
    await user.keyboard('{ArrowLeft}'); // slide under the overhang into the pocket
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];
    const landed = restingCells(board, 'I', emitted)!;
    expect(landed).not.toBeNull();
    // Seated in the covered pocket — not stranded on the col-3 floor.
    expect(keysOf(landed)).toEqual(new Set(['12-2', '13-2', '14-2', '15-2']));
    expect(keysOf(landed)).toEqual(landingKeys());
  });
});
