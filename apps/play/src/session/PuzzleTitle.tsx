/**
 * Puzzle title + share control (#49). A small "Puzzle #123" label with a
 * copy-link button, sized to keep with the slim top bar (#32) — no stacked
 * headers. Shown near the board on the play and feedback screens. Renders
 * nothing for legacy puzzles that have no number.
 */

import { useState } from 'react';
import { puzzleShareUrl } from '../share.js';

export function PuzzleTitle({ number }: { number: number | null }) {
  const [copied, setCopied] = useState(false);
  if (number === null) return null;

  const onShare = async () => {
    try {
      await navigator.clipboard?.writeText(puzzleShareUrl(number));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (older browser / denied permission) — no-op; the
      // link is still in the address bar for a shared puzzle.
    }
  };

  return (
    <div className="puzzle-title" data-testid="puzzle-title">
      <span className="puzzle-title-label">Puzzle #{number}</span>
      <button
        type="button"
        className="puzzle-share"
        onClick={() => void onShare()}
        aria-label={`Copy a shareable link to puzzle ${number}`}
      >
        {copied ? 'Copied!' : 'Share'}
      </button>
    </div>
  );
}
