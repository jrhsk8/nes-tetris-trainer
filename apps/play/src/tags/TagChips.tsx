/**
 * Puzzle type chips (#84): renders a puzzle's `tags` as small, colour-coded,
 * human-readable labels near the puzzle title, so a player can see what kind of
 * problem they're facing. Renders nothing when the puzzle has no tags. Labels
 * and colours come from the shared {@link TAG_VOCAB} vocabulary.
 */

import type { PuzzleTag } from '@trainer/core';
import { TAG_VOCAB } from './tagVocab.js';

export function TagChips({ tags }: { tags: readonly PuzzleTag[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="tag-chips" data-testid="tag-chips" aria-label="puzzle types">
      {tags.map((tag) => {
        const { label, kind } = TAG_VOCAB[tag];
        return (
          <li key={tag} className={`tag-chip tag-${kind}`} data-tag={tag}>
            {label}
          </li>
        );
      })}
    </ul>
  );
}
