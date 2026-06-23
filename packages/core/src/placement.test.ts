import { describe, it, expect } from 'vitest';
import {
  emptyBoard,
  encodeBoard,
  decodeBoard,
  applyPlacement,
  pieceCells,
  fitsAt,
  isResting,
  applyRestingPlacement,
  reachableStates,
  enumerateResting,
  lateralMove,
  moveToColumn,
  boardKey,
  resolveLineByOutcome,
  ORIENTATIONS,
  ROWS,
  COLS,
  PIECES,
  type Piece,
  type RestingPlacement,
  type Grid,
  type Line,
} from './index.js';

/**
 * Every floating state the player can actually navigate to via the on-screen /
 * keyboard inputs (#76): tuck-seeking lateral (both directions), soft-drop
 * (down), raise (up), and rotate (cw/ccw) — each gated on the BFS-reachable set
 * exactly as `PlacementInput` gates `canReach`. Seeded from the entry row (every
 * rotation/column that fits at the top), mirroring how pieces enter. A resting
 * placement is "reachable by input" iff its exact floating state appears here
 * (confirming there hard-drops in place). This is the navigation model the
 * completeness property asserts must cover every {@link enumerateResting}.
 */
function inputReachableStates(grid: Grid, piece: Piece): Set<number> {
  const states = reachableStates(grid, piece);
  const reachable = new Set(states.map((s) => key(s.rotation, s.row, s.col)));
  const canReach = (rot: number, r: number, c: number) => reachable.has(key(rot, r, c));
  const rotations = ORIENTATIONS[piece].length;

  const visited = new Set<number>();
  const queue: RestingPlacement[] = [];
  const seed = (s: RestingPlacement) => {
    const k = key(s.rotation, s.row, s.col);
    if (visited.has(k)) return;
    visited.add(k);
    queue.push(s);
  };
  // Entry seeds: every rotation/column that fits at the top row.
  for (let rotation = 0; rotation < rotations; rotation++) {
    for (let col = 0; col < COLS; col++) {
      if (canReach(rotation, 0, col)) seed({ rotation, row: 0, col });
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const { rotation, row, col } = queue[i];
    for (const dir of [-1, 1] as const) {
      const next = lateralMove(grid, piece, rotation, row, col, dir, states);
      if (next) seed(next);
    }
    if (canReach(rotation, row + 1, col)) seed({ rotation, row: row + 1, col }); // soft-drop
    if (canReach(rotation, row - 1, col)) seed({ rotation, row: row - 1, col }); // raise
    if (rotations > 1) {
      const cw = (rotation + 1) % rotations;
      const ccw = (rotation - 1 + rotations) % rotations;
      if (canReach(cw, row, col)) seed({ rotation: cw, row, col });
      if (canReach(ccw, row, col)) seed({ rotation: ccw, row, col });
    }
  }
  return visited;
}

function key(rotation: number, row: number, col: number): number {
  return (rotation * ROWS + row) * COLS + col;
}

describe('pieceCells / fitsAt / isResting', () => {
  it('places a piece at a board offset (bounding-box top-left at row,col)', () => {
    // Vertical I (rotation 1) at row 16, col 4 occupies rows 16..19 of column 4.
    expect(pieceCells('I', 1, 16, 4)).toEqual([
      [16, 4],
      [17, 4],
      [18, 4],
      [19, 4],
    ]);
  });

  it('fitsAt rejects out-of-bounds and occupied cells', () => {
    const grid = emptyBoard();
    grid[19][4] = 1;
    expect(fitsAt(grid, 'I', 1, 16, 4)).toBe(false); // overlaps the filled floor cell
    expect(fitsAt(grid, 'I', 1, 17, 9)).toBe(false); // rows 17..20 — row 20 off board
    expect(fitsAt(grid, 'O', 0, 18, 0)).toBe(true);
  });

  it('isResting is true only when the piece cannot move down', () => {
    const grid = emptyBoard();
    expect(isResting(grid, 'O', 0, 18, 0)).toBe(true); // on the floor
    expect(isResting(grid, 'O', 0, 0, 0)).toBe(false); // floating
  });
});

describe('applyRestingPlacement', () => {
  it('matches applyPlacement for a plain hard drop (acceptance c)', () => {
    const grid = emptyBoard();
    // O hard-dropped at col 3 rests on the floor: bounding-box top at row 18.
    const viaResting = applyRestingPlacement(grid, 'O', { rotation: 0, row: 18, col: 3 });
    const viaHardDrop = applyPlacement(grid, 'O', { rotation: 0, col: 3 });
    expect(viaResting).toEqual(viaHardDrop);
  });

  it('clears full rows after locking', () => {
    const grid = emptyBoard();
    for (let c = 0; c < 8; c++) grid[19][c] = 1; // row 19 filled except cols 8,9
    // Vertical I would not fill the row; use O across cols 8,9 to complete row 19.
    const out = applyRestingPlacement(grid, 'O', { rotation: 0, row: 18, col: 8 });
    // Row 19 was completed and cleared, leaving only the O's upper half at row 19.
    expect(out[19][8]).toBe(1);
    expect(out[19][9]).toBe(1);
    expect(out[18][8]).toBe(0);
  });

  it('throws on an illegal (overlapping) placement', () => {
    const grid = emptyBoard();
    grid[19][0] = 1;
    expect(() => applyRestingPlacement(grid, 'O', { rotation: 0, row: 18, col: 0 })).toThrow();
  });
});

describe('enumerateResting', () => {
  it('enumerates every hard-drop column on an empty board (acceptance c)', () => {
    const places = enumerateResting(emptyBoard(), 'O');
    // O is 2 wide, so cols 0..8, each resting with bbox-top at row 18.
    for (let col = 0; col <= 8; col++) {
      expect(places).toContainEqual<RestingPlacement>({ rotation: 0, row: 18, col });
    }
    // Every enumerated placement actually rests and is unique.
    for (const p of places) expect(isResting(emptyBoard(), 'O', p.rotation, p.row, p.col)).toBe(true);
  });

  it('enumerates a tuck resting placement under an overhang (acceptance a)', () => {
    // A ledge across cols 4..7 at row 10. Below it (rows 11..19) is open, but a
    // piece dropped straight down those columns lands ON the ledge — the space
    // beneath is reachable only by dropping down open col 3 and sliding right.
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;

    const tuck: RestingPlacement = { rotation: 1, row: 16, col: 4 };
    const places = enumerateResting(grid, 'I');

    // The tuck is enumerated...
    expect(places).toContainEqual(tuck);
    // ...it genuinely rests there...
    expect(isResting(grid, 'I', tuck.rotation, tuck.row, tuck.col)).toBe(true);
    // ...and it is NOT a hard drop: dropping straight down col 4 rests on the ledge.
    const hardDrop = places.find((p) => p.rotation === 1 && p.col === 4 && p.row < 10);
    expect(hardDrop).toBeDefined();
    expect(hardDrop!.row).toBe(6); // bottom at row 9, on top of the ledge
  });

  it('every enumerated placement is a superset of hard drops (binding invariant)', () => {
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;
    const places = enumerateResting(grid, 'I');
    // Both the on-ledge hard drop and the under-ledge tuck for col 4 are present.
    expect(places.some((p) => p.rotation === 1 && p.col === 4 && p.row === 6)).toBe(true);
    expect(places.some((p) => p.rotation === 1 && p.col === 4 && p.row === 16)).toBe(true);
  });
});

describe('lateralMove (free lateral movement #68)', () => {
  it('slides at the current row when the target column fits there', () => {
    // Empty board: moving right from a floating mid-board state just shifts column.
    const grid = emptyBoard();
    expect(lateralMove(grid, 'O', 0, 5, 3, 1)).toEqual({ rotation: 0, row: 5, col: 4 });
    expect(lateralMove(grid, 'O', 0, 5, 3, -1)).toEqual({ rotation: 0, row: 5, col: 2 });
  });

  it('rides UP over a wall instead of silently doing nothing', () => {
    // A tall wall fills col 9 from row 8 down. A vertical I resting deep in the
    // open col 8 well (rows 16..19) presses RIGHT toward the wall: the old code
    // gated on the current row and did nothing; now it rides up to rest ON the
    // wall (rows 4..7), the highest position that fits in col 9.
    const grid = emptyBoard();
    for (let r = 8; r < ROWS; r++) grid[r][9] = 1;
    const moved = lateralMove(grid, 'I', 1, 16, 8, 1);
    expect(moved).toEqual({ rotation: 1, row: 4, col: 9 });
    // The ride-up target genuinely rests on top of the wall.
    expect(isResting(grid, 'I', moved!.rotation, moved!.row, moved!.col)).toBe(true);
  });

  it('blocks only when the target column is full to the very top', () => {
    // Col 0 filled top-to-bottom: an O at col 1 cannot ride left into it.
    const grid = emptyBoard();
    for (let r = 0; r < ROWS; r++) grid[r][0] = 1;
    expect(lateralMove(grid, 'O', 0, 18, 1, -1)).toBeNull();
  });

  it('blocks a move that would carry the piece off-screen', () => {
    const grid = emptyBoard();
    // O occupies cols 8,9 at col 8 — moving right would push col 10 off-board.
    expect(lateralMove(grid, 'O', 0, 18, 8, 1)).toBeNull();
    // ...and a piece at col 0 cannot move left off the left wall.
    expect(lateralMove(grid, 'O', 0, 18, 0, -1)).toBeNull();
  });

  it('still slides into an open pocket at the current row (tuck preserved)', () => {
    // A ledge across cols 4..7 at row 10; below it (rows 11..19) is open. A
    // vertical I floating at row 16 in open col 3 slides RIGHT into the pocket
    // under the ledge at the same row — a tuck, not a ride-up.
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;
    expect(lateralMove(grid, 'I', 1, 16, 3, 1)).toEqual({ rotation: 1, row: 16, col: 4 });
  });

  it('every lateral move from a reachable state lands on a reachable state (superset invariant)', () => {
    // Lateral movement must never escape the BFS-reachable set, or it could
    // confirm a placement the generator never enumerated. Checked exhaustively
    // over game-realistic boards, every piece, and both directions.
    for (const grid of sampleBoards()) {
      for (const piece of PIECES) {
        const states = reachableStates(grid, piece);
        const reachable = new Set(
          states.map((s) => (s.rotation * ROWS + s.row) * COLS + s.col),
        );
        for (const s of states) {
          for (const dir of [-1, 1] as const) {
            // Reuse the precomputed reachable set so the exhaustive sweep does
            // not recompute the BFS per press (#76 moveToColumn reads it).
            const next = lateralMove(grid, piece, s.rotation, s.row, s.col, dir, states);
            if (next === null) continue;
            const key = (next.rotation * ROWS + next.row) * COLS + next.col;
            expect(reachable.has(key), `${piece} ${JSON.stringify(s)} dir ${dir}`).toBe(true);
          }
        }
      }
    }
  });

  it('tucks INTO a pocket below the press row instead of ejecting to the top (#76)', () => {
    // col 4 carries a wall at rows 10..15 with an open pocket below it (rows
    // 16..19) and open columns to the side for entry. Pressing toward col 4 from
    // row 12 does NOT fit at the press row (the wall), but the pocket below is
    // reachable. The OLD ride-up rule ejected the piece UP to rest on the wall
    // top (~row 8); tuck-seeking instead drops it DOWN into the pocket (row 16).
    const grid = emptyBoard();
    for (let r = 10; r <= 15; r++) grid[r][4] = 1;

    const moved = moveToColumn(grid, 'O', 0, 12, 4);
    expect(moved).not.toBeNull();
    expect(moved!.col).toBe(4);
    // Tucked DOWN (at or below the press row), not ejected up over the wall.
    expect(moved!.row).toBe(16);
    expect(moved!.row).toBeGreaterThanOrEqual(12);
  });

  it('navigation-completeness: input moves reach every resting placement (#76)', () => {
    // The model and the player input set must agree: a BFS over the ACTUAL input
    // moves (tuck-seeking lateral, soft-drop, raise, rotate) must reach every
    // placement the generator enumerates — no resting placement is gradeable but
    // unreachable. Checked exhaustively over game-realistic boards and pieces.
    for (const grid of sampleBoards()) {
      for (const piece of PIECES) {
        const reachableByInput = inputReachableStates(grid, piece);
        for (const p of enumerateResting(grid, piece)) {
          expect(
            reachableByInput.has(key(p.rotation, p.row, p.col)),
            `${piece} resting ${JSON.stringify(p)} unreachable by input`,
          ).toBe(true);
        }
      }
    }
  });

  it("reaches the J tucks into puzzle 1374's right-side col-4 / col-8 holes (#76)", () => {
    // The real board pulled from the live bank (puzzle #1374): a J could not be
    // tucked into the right-opening pockets at col 3 row 13 and col 7 row 15
    // (1-indexed "columns 4 and 8") because the ride-up rule ejected it. Both
    // tucks must now be reachable by input.
    const grid = decodeBoard(
      '00000000000000000000000000000000000000000000000000000000000000000000000000000000' +
        '1000000000100000000010000000001010000000111100000011100000001111001100111111100' +
        '01111111100111111111011111111101111111110',
    );
    const reachableByInput = inputReachableStates(grid, 'J');

    // Pockets: an empty cell capped by a filled cell above, opening to the right.
    const pockets: Array<[number, number]> = [
      [13, 3],
      [15, 7],
    ];
    for (const [pr, pc] of pockets) {
      expect(grid[pr][pc], `(${pr},${pc}) should be an empty pocket`).toBe(0);
      expect(grid[pr - 1][pc], `(${pr - 1},${pc}) should cap the pocket`).toBe(1);

      // A J resting placement that fills the pocket cell, reachable by input.
      const fills = enumerateResting(grid, 'J').filter((p) =>
        pieceCells('J', p.rotation, p.row, p.col).some(([r, c]) => r === pr && c === pc),
      );
      expect(fills.length, `no J resting placement fills (${pr},${pc})`).toBeGreaterThan(0);
      expect(
        fills.some((p) => reachableByInput.has(key(p.rotation, p.row, p.col))),
        `J tuck into (${pr},${pc}) not reachable by input`,
      ).toBe(true);
    }
  });
});

describe('resolveLineByOutcome (recover tuck rows from the stored boardKey #42)', () => {
  // A ledge across cols 4..7 at row 10; the pocket beneath (col 4, rows 16-19)
  // holds the true second placement — a TUCK. The stored combo records only
  // {rotation, col} (the resting row was dropped at generation), so by geometry
  // alone it is indistinguishable from a hard drop ONTO the ledge.
  function ledgeBoard(): Grid {
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;
    return grid;
  }
  const trueLine: readonly [RestingPlacement, RestingPlacement] = [
    { rotation: 0, col: 0, row: 18 }, // O parked bottom-left, out of the way
    { rotation: 1, col: 4, row: 16 }, // the tuck under the ledge
  ];
  const rowless: Line = [
    { rotation: 0, col: 0 },
    { rotation: 1, col: 4 },
  ];

  it('pins the resting rows so the recovered line reproduces the stored outcome', () => {
    const board = ledgeBoard();
    const outcome = boardKey(
      applyRestingPlacement(applyRestingPlacement(board, 'O', trueLine[0]), 'I', trueLine[1]),
    );

    const resolved = resolveLineByOutcome(board, 'O', 'I', rowless, outcome);
    // The second ply is pinned to the tuck row (16), NOT the hard-drop row (6).
    expect(resolved[1].row).toBe(16);
    // And re-applying the recovered line (applyPlacement respects the pinned row)
    // lands exactly the stored outcome.
    const rebuilt = boardKey(applyPlacement(applyPlacement(board, 'O', resolved[0]), 'I', resolved[1]));
    expect(rebuilt).toBe(outcome);
  });

  it('distinguishes the tuck from the hard drop down the same column', () => {
    const board = ledgeBoard();
    // The hard-drop outcome (no tuck) keys differently: the I rests ON the ledge.
    const hardDropKey = boardKey(
      applyRestingPlacement(applyRestingPlacement(board, 'O', trueLine[0]), 'I', {
        rotation: 1,
        col: 4,
        row: 6,
      }),
    );
    const resolved = resolveLineByOutcome(board, 'O', 'I', rowless, hardDropKey);
    expect(resolved[1].row).toBe(6); // recovers the on-ledge hard drop, not the tuck
  });

  it('returns the line unchanged when no outcome key is supplied', () => {
    expect(resolveLineByOutcome(ledgeBoard(), 'O', 'I', rowless)).toBe(rowless);
  });
});

describe('boardKey (canonical outcome key)', () => {
  it('two encodings landing the same cells produce the same key (acceptance b)', () => {
    const viaPlacement = applyRestingPlacement(emptyBoard(), 'O', { rotation: 0, row: 18, col: 0 });

    const manual = emptyBoard();
    manual[18][0] = manual[18][1] = manual[19][0] = manual[19][1] = 1;

    expect(boardKey(viaPlacement)).toBe(boardKey(manual));
    expect(boardKey(viaPlacement)).toBe(encodeBoard(viaPlacement));
  });

  it('a tuck placement and a directly-built identical board share a key', () => {
    const grid = emptyBoard();
    for (let c = 4; c <= 7; c++) grid[10][c] = 1;
    const tucked = applyRestingPlacement(grid, 'I', { rotation: 1, row: 16, col: 4 });

    const manual = emptyBoard();
    for (let c = 4; c <= 7; c++) manual[10][c] = 1;
    for (let r = 16; r <= 19; r++) manual[r][4] = 1;

    expect(boardKey(tucked)).toBe(boardKey(manual));
  });
});

// A spread of game-realistic boards: empty, flat-with-ledges, wells, holes,
// tall stacks, and a pseudo-random fill. Shared by the reachability and
// free-lateral invariant tests.
function sampleBoards(): Grid[] {
  const boards: Grid[] = [emptyBoard()];

  // A right-edge well (the bar's natural home) — flush-right at cols 6..9 is
  // legal, off-board is not.
  const well = emptyBoard();
  for (let r = 10; r < ROWS; r++) for (let c = 0; c < COLS - 1; c++) well[r][c] = 1;
  boards.push(well);

  // A left-edge well (mirror of the above).
  const leftWell = emptyBoard();
  for (let r = 10; r < ROWS; r++) for (let c = 1; c < COLS; c++) leftWell[r][c] = 1;
  boards.push(leftWell);

  // Overhang ledges that admit tucks at both walls.
  const ledges = emptyBoard();
  for (let c = 0; c <= 3; c++) ledges[12][c] = 1;
  for (let c = 6; c < COLS; c++) ledges[12][c] = 1;
  boards.push(ledges);

  // Tall, bumpy, holey near-topout boards.
  for (let seed = 1; seed <= 24; seed++) {
    const g = emptyBoard();
    let x = seed * 2654435761;
    const next = () => {
      x = (x ^ (x << 13)) >>> 0;
      x = (x ^ (x >>> 17)) >>> 0;
      x = (x ^ (x << 5)) >>> 0;
      return x / 0xffffffff;
    };
    for (let c = 0; c < COLS; c++) {
      const h = Math.floor(next() * 16); // up to 16 tall (near topout)
      for (let r = ROWS - 1; r >= ROWS - h; r--) {
        if (next() > 0.2) g[r][c] = 1; // ~20% holes
      }
    }
    boards.push(g);
  }
  return boards;
}

describe('reachable states never leave the board (#58 right-wall guard)', () => {
  // The right-wall report claimed a bar could reach past col 9; this proves the
  // model can never produce an out-of-bounds cell for ANY piece on these boards.
  it('every reachable state of every piece renders in-bounds', () => {
    for (const grid of sampleBoards()) {
      for (const piece of PIECES) {
        for (const { rotation, row, col } of reachableStates(grid, piece)) {
          for (const [r, c] of pieceCells(piece, rotation, row, col)) {
            expect(r, `${piece} rot${rotation} (${row},${col})`).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(ROWS);
            expect(c, `${piece} rot${rotation} (${row},${col})`).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThan(COLS);
          }
        }
      }
    }
  });
});
