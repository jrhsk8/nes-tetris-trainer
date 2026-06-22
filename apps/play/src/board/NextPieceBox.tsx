/**
 * Next-piece box (#22, #23, #63) — the NES-style "NEXT" panel in the right rail
 * while solving placement 1. It draws the next piece as the real NES block
 * graphic (spawn orientation, colour group, reusing the level-18 sprites in
 * `nes.ts`) inside a fixed-size recessed black well that matches the board
 * well's border/shadow.
 *
 * The well has a CONSTANT footprint — a fixed `FOOT_ROWS × FOOT_COLS` cell grid
 * at the board's cell scale — and the piece is centred within it, so the box
 * never resizes between pieces (#63). During placement 2 there is no lookahead,
 * so the well renders empty.
 *
 * The piece letter is kept as a visually-hidden label so the box stays
 * announceable and the play-flow tests can still locate the piece.
 */

import { ORIENTATIONS, type Piece } from '@trainer/core';
import { blockBackground, PIECE_GROUP } from './nes.js';

export interface NextPieceBoxProps {
  /** The next piece, or null when there is no lookahead (placement 2). */
  piece: Piece | null;
}

// The fixed well footprint: 4 wide × 2 tall holds every spawn orientation (the
// flat I is 4×1, the rest 3×2 or 2×2) centred, so the box never resizes (#63).
const FOOT_COLS = 4;
const FOOT_ROWS = 2;

/** The spawn-orientation cells of `piece` and the bounding box that holds them. */
function spawnShape(piece: Piece): { rows: number; cols: number; filled: Set<string> } {
  const cells = ORIENTATIONS[piece][0];
  let rows = 0;
  let cols = 0;
  const filled = new Set<string>();
  for (const [r, c] of cells) {
    filled.add(`${r}-${c}`);
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { rows, cols, filled };
}

export function NextPieceBox({ piece }: NextPieceBoxProps) {
  const shape = piece ? spawnShape(piece) : null;
  // Centre the piece's bounding box within the fixed footprint.
  const rowOffset = shape ? Math.floor((FOOT_ROWS - shape.rows) / 2) : 0;
  const colOffset = shape ? Math.floor((FOOT_COLS - shape.cols) / 2) : 0;
  const background = piece ? blockBackground(PIECE_GROUP[piece]) : '';

  return (
    <div className="next-box" aria-label="next piece box">
      <p className="next-box-label">Next</p>
      <div
        className="next-well"
        data-testid={piece ? 'next-piece' : undefined}
        role={piece ? 'img' : undefined}
        aria-label={piece ? `next piece ${piece}` : undefined}
        aria-hidden={piece ? undefined : true}
      >
        {piece ? <span className="sr-only">{piece}</span> : null}
        <div className="next-piece-grid" aria-hidden="true">
          {Array.from({ length: FOOT_ROWS * FOOT_COLS }, (_, i) => {
            const r = Math.floor(i / FOOT_COLS);
            const c = i % FOOT_COLS;
            const isFilled = shape?.filled.has(`${r - rowOffset}-${c - colOffset}`) ?? false;
            return (
              <div
                key={`${r}-${c}`}
                data-testid={isFilled ? 'next-filled' : 'next-empty'}
                className={`next-cell ${isFilled ? 'next-cell-filled' : 'next-cell-empty'}`}
                style={{
                  aspectRatio: '1 / 1',
                  backgroundColor: '#000',
                  backgroundSize: '100% 100%',
                  ...(isFilled ? { backgroundImage: background } : {}),
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
