/**
 * Next-piece box (#22) — the NES-style "next" panel that lives in the right
 * rail of the play screen while solving placement 1. For now it shows the piece
 * letter; #23 replaces the body with the real NES block graphic. During
 * placement 2 there is no lookahead, so the box renders empty.
 */

import type { Piece } from '@trainer/core';

export interface NextPieceBoxProps {
  /** The next piece, or null when there is no lookahead (placement 2). */
  piece: Piece | null;
}

export function NextPieceBox({ piece }: NextPieceBoxProps) {
  return (
    <div className="next-box" aria-label="next piece box">
      <p className="next-box-label">Next</p>
      {piece ? (
        <p className="next-box-piece" data-testid="next-piece">
          {piece}
        </p>
      ) : (
        <p className="next-box-empty" aria-hidden="true">
          —
        </p>
      )}
    </div>
  );
}
