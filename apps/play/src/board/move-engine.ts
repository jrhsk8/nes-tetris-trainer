import {
  COLS,
  ROWS,
  ORIENTATIONS,
  fitsAt,
  isResting,
  pieceCells,
  reachableStates,
  spin as coreSpin,
  type Grid,
  type Piece,
} from '@trainer/core';

export interface MoveState {
  rotation: number;
  row: number;
  col: number;
  resting: boolean;
  outlineCells: readonly [number, number][];
  landingCells: readonly [number, number][] | undefined;
}

function stateKey(rotation: number, row: number, col: number): number {
  return (rotation * ROWS + row) * COLS + col;
}

function settleRow(board: Grid, piece: Piece, rotation: number, row: number, col: number): number {
  let r = row;
  while (fitsAt(board, piece, rotation, r + 1, col)) r++;
  return r;
}

const SPAWN_COLUMN = 3;

function spawnColumn(board: Grid, piece: Piece): number {
  for (let d = 0; d < COLS; d++) {
    for (const col of d === 0 ? [SPAWN_COLUMN] : [SPAWN_COLUMN - d, SPAWN_COLUMN + d]) {
      if (col >= 0 && col < COLS && fitsAt(board, piece, 0, 0, col)) return col;
    }
  }
  return 0;
}

export interface MoveEngine {
  state(): MoveState;
  moveLeft(): void;
  moveRight(): void;
  softDrop(): void;
  raise(): void;
  rotateCw(): void;
  rotateCcw(): void;
  dragToCol(targetCol: number): void;
  confirm(): { rotation: number; col: number; row: number } | null;
  reset(): void;
}

export function createMoveEngine(
  board: Grid,
  piece: Piece,
  onChange: () => void,
): MoveEngine {
  const rotationCount = ORIENTATIONS[piece].length;
  const reachableList = reachableStates(board, piece);
  const reachable = new Set<number>();
  for (const s of reachableList) reachable.add(stateKey(s.rotation, s.row, s.col));

  let rotation = 0;
  let col = spawnColumn(board, piece);
  let row = 0;

  function canReach(rot: number, r: number, c: number): boolean {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS && reachable.has(stateKey(rot, r, c));
  }

  function computeResting(): boolean {
    return isResting(board, piece, rotation, row, col);
  }

  function computeOutline(): readonly [number, number][] {
    return pieceCells(piece, rotation, row, col);
  }

  function computeLanding(): readonly [number, number][] | undefined {
    if (computeResting()) return undefined;
    const landRow = settleRow(board, piece, rotation, row, col);
    return pieceCells(piece, rotation, landRow, col);
  }

  function slideStep(
    rot: number,
    r: number,
    c: number,
    dir: -1 | 1,
  ): { row: number; col: number } | null {
    const nc = c + dir;
    if (nc < 0 || nc >= COLS) return null;
    let nr = r;
    while (nr >= 0 && !canReach(rot, nr, nc)) nr--;
    if (nr < 0) return null;
    return { col: nc, row: settleRow(board, piece, rot, nr, nc) };
  }

  function lateral(dir: -1 | 1): void {
    const next = slideStep(rotation, row, col, dir);
    if (!next) return;
    col = next.col;
    row = next.row;
    onChange();
  }

  return {
    state() {
      return {
        rotation,
        row,
        col,
        resting: computeResting(),
        outlineCells: computeOutline(),
        landingCells: computeLanding(),
      };
    },

    moveLeft() { lateral(-1); },
    moveRight() { lateral(1); },

    softDrop() {
      if (canReach(rotation, row + 1, col)) {
        row++;
        onChange();
      }
    },

    raise() {
      if (canReach(rotation, row - 1, col)) {
        row--;
        onChange();
      }
    },

    rotateCw() {
      if (rotationCount < 2) return;
      const next = coreSpin(board, piece, rotation, row, col, 'cw', reachableList);
      if (next) {
        rotation = next.rotation;
        row = next.row;
        col = next.col;
        onChange();
      }
    },

    rotateCcw() {
      if (rotationCount < 2) return;
      const next = coreSpin(board, piece, rotation, row, col, 'ccw', reachableList);
      if (next) {
        rotation = next.rotation;
        row = next.row;
        col = next.col;
        onChange();
      }
    },

    dragToCol(targetCol: number) {
      const step = targetCol > col ? 1 : -1;
      let c = col;
      let r = row;
      while (c !== targetCol) {
        const next = slideStep(rotation, r, c, step as -1 | 1);
        if (!next) break;
        c = next.col;
        r = next.row;
      }
      if (c !== col) {
        col = c;
        row = r;
        onChange();
      }
    },

    confirm() {
      if (!computeResting()) return null;
      return { rotation, col, row };
    },

    reset() {
      rotation = 0;
      col = spawnColumn(board, piece);
      row = 0;
      onChange();
    },
  };
}
