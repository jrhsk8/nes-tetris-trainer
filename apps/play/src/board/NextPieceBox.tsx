/**
 * Next-piece box (#22, #23) — the NES-style "next" panel that lives in the
 * right rail of the play screen while solving placement 1. It draws the next
 * piece as the real NES block graphic in its spawn orientation and colour
 * group (reusing the level-18 sprites in `nes.ts`). During placement 2 there is
 * no lookahead, so the box renders empty.
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
  if (!piece) {
    return (
      <div className="next-box" aria-label="next piece box">
        <p className="next-box-label">Next</p>
        <p className="next-box-empty" aria-hidden="true">
          —
        </p>
      </div>
    );
  }

  const { rows, cols, filled } = spawnShape(piece);
  const background = blockBackground(PIECE_GROUP[piece]);

  return (
    <div className="next-box" aria-label="next piece box">
      <p className="next-box-label">Next</p>
      <div
        className="next-box-piece"
        data-testid="next-piece"
        role="img"
        aria-label={`next piece ${piece}`}
      >
        <span className="sr-only">{piece}</span>
        <div
          className="next-piece-grid"
          aria-hidden="true"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, var(--next-cell, 20px))`,
            gridTemplateRows: `repeat(${rows}, var(--next-cell, 20px))`,
            lineHeight: 0,
          }}
        >
          {Array.from({ length: rows * cols }, (_, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const isFilled = filled.has(`${r}-${c}`);
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
