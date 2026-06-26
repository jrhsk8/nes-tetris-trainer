/**
 * The single display vocabulary for puzzle type-tags (#84): the human-readable
 * label and colour group for every {@link PuzzleTag}. One source of truth so the
 * play chips (#84) and the drill-mode type picker (#85) read the same names and
 * colours — change a label here and both follow.
 */

import type { PuzzleTag } from '@trainer/core';

/** A tag's colour family (maps to a CSS class `tag-<kind>`). */
export type TagKind = 'clear' | 'maneuver' | 'stack' | 'avoid';

/** Display label + colour family for one tag. */
export interface TagDisplay {
  label: string;
  kind: TagKind;
}

/** Label + colour for every tag in the closed {@link PuzzleTag} union. */
export const TAG_VOCAB: Record<PuzzleTag, TagDisplay> = {
  burn: { label: 'Burn', kind: 'clear' },
  tetris: { label: 'Tetris', kind: 'clear' },
  'tetris-ready': { label: 'Tetris ready', kind: 'clear' },
  dig: { label: 'Dig', kind: 'clear' },
  tuck: { label: 'Tuck', kind: 'maneuver' },
  spin: { label: 'Spin', kind: 'maneuver' },
  spintuck: { label: 'Spintuck', kind: 'maneuver' },
  't-spin': { label: 'T-spin', kind: 'maneuver' },
  's-spin': { label: 'S-spin', kind: 'maneuver' },
  'z-spin': { label: 'Z-spin', kind: 'maneuver' },
  'l-spin': { label: 'L-spin', kind: 'maneuver' },
  'j-spin': { label: 'J-spin', kind: 'maneuver' },
  'clean-stacking': { label: 'Clean stacking', kind: 'stack' },
  'well-maintenance': { label: 'Well maintenance', kind: 'stack' },
  'avoid-i-dependency': { label: 'Avoid I-dep', kind: 'avoid' },
  'avoid-s-dependency': { label: 'Avoid S-dep', kind: 'avoid' },
  'avoid-z-dependency': { label: 'Avoid Z-dep', kind: 'avoid' },
  'avoid-j-dependency': { label: 'Avoid J-dep', kind: 'avoid' },
  'avoid-l-dependency': { label: 'Avoid L-dep', kind: 'avoid' },
};

/** The display label + colour for a tag (one source of truth). */
export function tagDisplay(tag: PuzzleTag): TagDisplay {
  return TAG_VOCAB[tag];
}
