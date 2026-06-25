// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

/**
 * The set of "row-col" keys of the SINGLE free-floating outline (#89), whether
 * it is plain (`outline`) or glowing because it rests (`outline-resting`). There
 * is no separate drop-shadow, so this is the one cursor — and, once resting, the
 * WYSIWYG target a confirmed placement equals.
 */
function outlineKeys(): Set<string> {
  return new Set([...cellsInState('outline'), ...cellsInState('outline-resting')]);
}

/** Drive the focused placement input down until the outline rests, then confirm. */
async function settleAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText('placement input');
  input.focus();
  for (let i = 0; i < 22 && input.getAttribute('data-resting') !== 'true'; i++) {
    await user.keyboard('{ArrowDown}');
  }
  await user.keyboard('{Enter}');
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

  it('draws the single floating outline where asked (#89)', () => {
    render(<Board grid={emptyBoard()} outlineCells={[[18, 4]]} />);
    expect(screen.getByTestId('cell-18-4')).toHaveAttribute('data-state', 'outline');
  });

  it('glows the outline once the piece rests, the ready-to-lock cue (#89)', () => {
    const { rerender } = render(<Board grid={emptyBoard()} outlineCells={[[18, 4]]} outlinePiece="Z" />);
    const floating = screen.getByTestId('cell-18-4');
    // Floating: a solid bright sprite with a light inset edge, NO outer glow.
    expect(floating).toHaveAttribute('data-state', 'outline');
    expect(floating.style.boxShadow).toContain('inset');
    expect(floating.style.boxShadow).not.toMatch(/,\s*0 0/); // no outer glow term

    rerender(<Board grid={emptyBoard()} outlineCells={[[18, 4]]} outlinePiece="Z" outlineResting />);
    const resting = screen.getByTestId('cell-18-4');
    expect(resting).toHaveAttribute('data-state', 'outline-resting');
    // Resting: the same inset edge PLUS an outer glow in the piece colour.
    expect(resting.style.boxShadow).toContain('inset');
    expect(resting.style.boxShadow).toMatch(/,\s*0 0/); // outer glow present
    expect(resting.style.boxShadow).toContain('rgba(216, 40, 0'); // glow is the piece colour ($16 red)
  });

  it('draws only the single piloted outline — no separate landing projection (#93)', () => {
    render(<Board grid={emptyBoard()} outlineCells={[[1, 4]]} outlinePiece="Z" />);
    // The one floating outline is drawn where the piece is.
    expect(screen.getByTestId('cell-1-4')).toHaveAttribute('data-state', 'outline');
    // No faint ghost anywhere down the column: dropping is how the player sees
    // where the piece lands (#93 removed the landing projection).
    const states = screen
      .getAllByRole('gridcell')
      .map((el) => el.getAttribute('data-state'));
    expect(states).not.toContain('landing');
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

  it('colours the floating piece in its piece colour (Z → $16 red) (#18, #89)', () => {
    render(<Board grid={emptyBoard()} outlineCells={[[18, 4]]} outlinePiece="Z" />);
    const cell = screen.getByTestId('cell-18-4');
    // The floating piece is a solid bright sprite drawn in the piece colour.
    expect(decodeURIComponent(cell.style.backgroundImage)).toContain('#d82800');
  });

  it('draws the floating piece as a solid bright sprite, distinct from a locked cell and the gold highlight (#89)', () => {
    const grid: Grid = emptyBoard();
    grid[19][0] = 1; // a locked cell
    render(
      <Board
        grid={grid}
        outlineCells={[[18, 4]]}
        outlinePiece="Z"
        highlightCells={[[17, 4]]}
        highlightPiece="Z"
      />,
    );
    const outline = screen.getByTestId('cell-18-4');
    const locked = screen.getByTestId('cell-19-0');
    const highlight = screen.getByTestId('cell-17-4');

    // The floating piece is a solid sprite (like a locked block) but carries a
    // light inset edge so it reads as the live, movable cursor.
    expect(outline.style.backgroundImage).not.toBe('');
    expect(locked.style.backgroundImage).not.toBe('');
    expect(outline.style.boxShadow).toContain('inset');
    expect(locked.style.boxShadow).toBe('');
    // ...and it never carries the feedback highlight's accent.
    expect(outline.style.boxShadow).not.toContain('#d98b6a');
    expect(highlight.style.boxShadow).toContain('#d98b6a');
  });

  it('never draws a cell outside the grid, even given out-of-bounds cells (#58 guard)', () => {
    // Belt-and-suspenders: the reachability model already proves no piece reaches
    // past col 9 (placement.test.ts), but Board must never render OOB even if fed
    // anomalous data. Past the right wall (col 10), the left wall (col -1), and
    // below the floor (row 20) are all silently dropped.
    render(
      <Board
        grid={emptyBoard()}
        outlineCells={[
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
    expect(outlineKeys().size).toBe(0);
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
  it('spawns one floating outline at the top, not resting, with Confirm gated (#89)', () => {
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    // Exactly one outline (4 cells), spawned floating at the top row.
    const shown = outlineKeys();
    expect(shown.size).toBe(4);
    expect([...shown].every((k) => Number(k.split('-')[0]) <= 1)).toBe(true);
    // Not resting yet: no glow, and Confirm is disabled until it rests.
    expect(screen.getByLabelText('placement input')).toHaveAttribute('data-resting', 'false');
    expect(cellsInState('outline-resting').size).toBe(0);
    expect(screen.getByRole('button', { name: 'Confirm placement' })).toBeDisabled();
  });

  it('glows and enables Confirm once the outline rests (#89)', async () => {
    const user = userEvent.setup();
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    const input = screen.getByLabelText('placement input');
    input.focus();
    for (let i = 0; i < 22 && input.getAttribute('data-resting') !== 'true'; i++) {
      await user.keyboard('{ArrowDown}');
    }
    // Rested on the floor: the outline glows and Confirm is enabled.
    expect(input).toHaveAttribute('data-resting', 'true');
    expect(cellsInState('outline-resting').size).toBe(4);
    expect(screen.getByRole('button', { name: 'Confirm placement' })).toBeEnabled();
  });

  it('there is exactly ONE outline with the piece one row above its landing — no partial ghost (#89)', async () => {
    const user = userEvent.setup();
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    const input = screen.getByLabelText('placement input');
    input.focus();
    // Drop to rest, then lift one row so the piece floats just above its landing —
    // the exact case that produced the old "awkward partial ghost".
    for (let i = 0; i < 22 && input.getAttribute('data-resting') !== 'true'; i++) {
      await user.keyboard('{ArrowDown}');
    }
    await user.keyboard('{ArrowUp}');
    // Still exactly ONE outline (4 cells), now floating (not resting) — no second
    // muted copy at the landing row.
    expect(outlineKeys().size).toBe(4);
    expect(input).toHaveAttribute('data-resting', 'false');
  });

  it('auto-focuses the board on load so the loop is no-mouse (#64)', () => {
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    // No click needed — keystrokes land on the placement input immediately.
    expect(screen.getByLabelText('placement input')).toHaveFocus();
  });

  it('moves and rotates the outline, then emits the resting cells that were shown (#89)', async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="T" onConfirm={onConfirm} />);

    const before = outlineKeys();
    await user.click(screen.getByRole('button', { name: 'Move right' }));
    expect(outlineKeys()).not.toEqual(before); // the outline actually moved
    await user.click(screen.getByRole('button', { name: 'Rotate clockwise' }));

    // Settle to rest, then confirm: the emitted placement equals the resting
    // outline that was shown — what you saw is what you get.
    await settleAndConfirm(user);
    const shownAtConfirm = outlineKeys();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];
    const landed = restingCells(board, 'T', emitted);
    expect(landed).not.toBeNull();
    expect(keysOf(landed!)).toEqual(shownAtConfirm);
  });

  it('supports keyboard control (arrows + enter), confirming the resting outline (#89)', async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="L" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    // ArrowLeft shifts to the adjacent column (preserving height); settle to rest.
    await user.keyboard('{ArrowLeft}');
    const input = screen.getByLabelText('placement input');
    for (let i = 0; i < 22 && input.getAttribute('data-resting') !== 'true'; i++) {
      await user.keyboard('{ArrowDown}');
    }
    const shown = outlineKeys();
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];
    // What you confirm is exactly the resting outline that was drawn.
    const landed = keysOf(restingCells(board, 'L', emitted)!);
    expect(landed).toEqual(shown);
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
    // Settle to rest (Confirm is gated on resting), then the custom Space binds.
    const input = screen.getByLabelText('placement input');
    for (let i = 0; i < 22 && input.getAttribute('data-resting') !== 'true'; i++) {
      await user.keyboard('{ArrowDown}');
    }
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
    await user.keyboard('x'); // rotate I to vertical (NES offset shifts col +2 → col 5)
    await user.keyboard('{ArrowLeft}{ArrowLeft}'); // walk back to col 3
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
    expect(keysOf(landed)).toEqual(outlineKeys());
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
    expect(outlineKeys()).toEqual(new Set(['4-9', '5-9', '6-9', '7-9']));
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const landed = restingCells(board, 'I', onConfirm.mock.calls[0][0])!;
    // Seated on top of the wall, reached by a single lateral press.
    expect(keysOf(landed)).toEqual(new Set(['4-9', '5-9', '6-9', '7-9']));
    expect(keysOf(landed)).toEqual(outlineKeys());
  });

  it('slides freely both ways: rides up onto a wall, then back down into the well (#81)', async () => {
    const user = userEvent.setup();
    // col-9 wall (rows 8-19), col-8 well. From the well floor, RIGHT rides up onto
    // the wall (rows 4..7); LEFT slides back to col 8 at the same height (row 4),
    // then soft-drop settles into the well (rows 16..19).
    const board = emptyBoard();
    for (let r = 8; r < 20; r++) board[r][9] = 1;
    const onConfirm = vi.fn<(p: Placement) => void>();
    render(<PlacementInput board={board} piece="I" onConfirm={onConfirm} />);

    await user.click(screen.getByLabelText('placement input'));
    await user.keyboard('x'); // vertical I
    for (let i = 0; i < 5; i++) await user.keyboard('{ArrowRight}'); // walk to col 8 well
    for (let i = 0; i < 20; i++) await user.keyboard('{ArrowDown}'); // soft-drop to the floor
    await user.keyboard('{ArrowRight}'); // ride up onto the wall
    expect(outlineKeys()).toEqual(new Set(['4-9', '5-9', '6-9', '7-9']));
    await user.keyboard('{ArrowLeft}'); // slide back to col 8 (preserving height)
    expect(outlineKeys()).toEqual(new Set(['4-8', '5-8', '6-8', '7-8']));
    // Settle into the well, then confirm
    const input = screen.getByLabelText('placement input');
    for (let i = 0; i < 22 && input.getAttribute('data-resting') !== 'true'; i++) {
      await user.keyboard('{ArrowDown}');
    }
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
    // Drag to near the right wall (x≈300 → finger col 9). The O (2 wide) clamps
    // to col 8 (cols 8,9), preserving height at the spawn row.
    fireEvent(surface, ptr('pointerdown', 300));
    fireEvent(surface, ptr('pointermove', 300));

    // Lift-to-place must NOT commit — only the explicit Confirm button does.
    fireEvent(surface, ptr('pointerup', 300));
    expect(onConfirm).not.toHaveBeenCalled();

    // Settle to rest, then confirm.
    await settleAndConfirm(user);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const landed = restingCells(board, 'O', onConfirm.mock.calls[0][0])!;
    expect(keysOf(landed)).toEqual(new Set(['18-8', '18-9', '19-8', '19-9']));
    expect(keysOf(landed)).toEqual(outlineKeys());
  });

  it('drag positions against a wall at the nearest reachable column (#69, #81)', () => {
    const board = emptyBoard();
    for (let r = 8; r < 20; r++) board[r][9] = 1; // wall in col 9
    const onConfirm = vi.fn<(p: Placement) => void>();
    const { container } = render(
      <PlacementInput board={board} piece="I" onConfirm={onConfirm} />,
    );
    mockGrid(container);

    const surface = screen.getByLabelText('board drag surface');
    // Drag the horizontal I toward the wall column — it walks as far right as
    // possible (col 6, cells at 6-9) preserving the spawn-row height, never
    // off-board.
    fireEvent(surface, ptr('pointerdown', 315));

    const landing = outlineKeys();
    expect(landing.size).toBe(4);
    expect(landing.has('0-9')).toBe(true);
    expect(landing.has('0-6')).toBe(true);
  });

  it('a board drag only moves while the pointer is down, not after release (#69)', () => {
    const board = emptyBoard();
    const { container } = render(<PlacementInput board={board} piece="O" onConfirm={vi.fn()} />);
    mockGrid(container);
    const surface = screen.getByLabelText('board drag surface');

    fireEvent(surface, ptr('pointerdown', 30)); // left side
    const afterLeft = outlineKeys();
    fireEvent(surface, ptr('pointerup', 30));
    fireEvent(surface, ptr('pointermove', 300)); // move after release — ignored
    expect(outlineKeys()).toEqual(afterLeft);
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
    await user.keyboard('x'); // rotate I to vertical (NES offset shifts col +2 → col 5)
    await user.keyboard('{ArrowLeft}{ArrowLeft}'); // walk back to col 3
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
    expect(keysOf(landed)).toEqual(outlineKeys());
  });

  it('spins a piece resting on the floor — rotation changes, no silent no-op (#88/#89)', async () => {
    const user = userEvent.setup();
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    const input = screen.getByLabelText('placement input');
    input.focus();
    // Drop the T onto the floor so it rests (the case the old code no-op'd on).
    for (let i = 0; i < 22 && input.getAttribute('data-resting') !== 'true'; i++) {
      await user.keyboard('{ArrowDown}');
    }
    expect(input).toHaveAttribute('data-resting', 'true');
    const before = input.getAttribute('data-rotation');
    await user.click(screen.getByRole('button', { name: 'Rotate clockwise' }));
    // Spin kicks up to a reachable rotated state instead of doing nothing.
    expect(input.getAttribute('data-rotation')).not.toBe(before);
    expect(outlineKeys().size).toBe(4); // still exactly one outline
  });

  it('soft-drop button TAP drops exactly one row — no auto-repeat (#92)', () => {
    vi.useFakeTimers();
    try {
      render(<PlacementInput board={emptyBoard()} piece="O" onConfirm={vi.fn()} />);
      const input = screen.getByLabelText('placement input');
      const drop = screen.getByRole('button', { name: 'Soft drop' });
      const startRow = Number(input.getAttribute('data-row'));
      // Tap: press and release BEFORE the hold-to-snap delay (250 ms).
      act(() => {
        fireEvent(drop, new MouseEvent('pointerdown', { bubbles: true }));
      });
      act(() => {
        vi.advanceTimersByTime(100); // still within the tap window
      });
      act(() => {
        fireEvent(drop, new MouseEvent('pointerup', { bubbles: true }));
      });
      // Exactly one row — the old 60 ms per-row auto-repeat is gone.
      expect(Number(input.getAttribute('data-row'))).toBe(startRow + 1);
      // And no late snap fires after release.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(Number(input.getAttribute('data-row'))).toBe(startRow + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('soft-drop button HOLD past the delay snaps to the settle row (#92)', () => {
    vi.useFakeTimers();
    try {
      render(<PlacementInput board={emptyBoard()} piece="O" onConfirm={vi.fn()} />);
      const input = screen.getByLabelText('placement input');
      const drop = screen.getByRole('button', { name: 'Soft drop' });
      // Hold past the delay: the piece snaps straight to the bottom (O settles
      // with its base on row 19, bbox top-left at row 18).
      act(() => {
        fireEvent(drop, new MouseEvent('pointerdown', { bubbles: true }));
      });
      act(() => {
        vi.advanceTimersByTime(300); // past the 250 ms hold delay
      });
      act(() => {
        fireEvent(drop, new MouseEvent('pointerup', { bubbles: true }));
      });
      expect(input).toHaveAttribute('data-row', '18');
      expect(input).toHaveAttribute('data-resting', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('soft-drop key TAP = one row; OS key-repeat does NOT auto-repeat (#92)', () => {
    vi.useFakeTimers();
    try {
      render(<PlacementInput board={emptyBoard()} piece="O" onConfirm={vi.fn()} />);
      const input = screen.getByLabelText('placement input');
      const startRow = Number(input.getAttribute('data-row'));
      act(() => {
        fireEvent.keyDown(input, { key: 'ArrowDown' });
      });
      // OS auto-repeat keydowns (event.repeat) must be ignored — the timer, not
      // repeat, drives the snap.
      act(() => {
        fireEvent.keyDown(input, { key: 'ArrowDown', repeat: true });
        fireEvent.keyDown(input, { key: 'ArrowDown', repeat: true });
      });
      // Release before the delay: a clean one-row tap.
      act(() => {
        vi.advanceTimersByTime(100);
        fireEvent.keyUp(input, { key: 'ArrowDown' });
      });
      expect(Number(input.getAttribute('data-row'))).toBe(startRow + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no hard-drop / snap control — only soft-drop (#89, #92)', () => {
    render(<PlacementInput board={emptyBoard()} piece="T" onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /hard drop|snap|drop to bottom/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Soft drop' })).toBeInTheDocument();
  });
});
