/**
 * Ranked combo list (#35) — replaces the per-ply strip-plot chart (#29). A
 * stacked, ranked list of the puzzle's top-5 two-piece combos with their grades
 * (letter + one-decimal score, #60; docs/glossary.md "Ranked combo list"). The
 * player's own combo is highlighted in-list when it is among the top-5;
 * otherwise a row below shows its
 * exact rank + score (ranks 6–30) or "too low to rank" (beyond the stored
 * top-K). Rows are interactive: selecting one replays that combo on the central
 * board.
 */

import type { ComboEntry, Line, Placement } from '@trainer/core';
import { formatScore } from './grade.js';

export interface ComboListProps {
  /** The stored top-K combos, best-first (rank 1 = index 0). */
  entries: readonly ComboEntry[];
  /** Total ranked combos for the puzzle (the "of N" denominator). */
  total: number;
  /** The placements the player actually made. */
  userLine: readonly Placement[];
  /** The player's 1-based rank within the stored top-K, or null if unranked. */
  playerRank: number | null;
  /** The player's combo score, or null if unranked. */
  playerScore: number | null;
  /** The currently selected combo (highlighted + shown on the board). */
  selected: Line;
  /** Select a combo to replay it on the board. */
  onSelect: (line: Line) => void;
}

/** How many top combos to list. */
const TOP_N = 5;

/** "1st", "2nd", "3rd", … */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const entryLine = (e: ComboEntry): Line => [
  { rotation: e.rot1, col: e.col1 },
  { rotation: e.rot2, col: e.col2 },
];

const sameLine = (a: Line, b: Line): boolean =>
  a[0].rotation === b[0].rotation &&
  a[0].col === b[0].col &&
  a[1].rotation === b[1].rotation &&
  a[1].col === b[1].col;

export function ComboList({
  entries,
  total,
  userLine,
  playerRank,
  playerScore,
  selected,
  onSelect,
}: ComboListProps) {
  const top = entries.slice(0, TOP_N);
  const playerInTop = playerRank !== null && playerRank <= TOP_N;
  const playerLine: Line | null =
    userLine.length >= 2 ? [userLine[0], userLine[1]] : null;

  return (
    <div className="combo-list" data-testid="combo-list">
      <p className="combo-list-label">Top combos · {total} ranked</p>

      {top.map((entry, i) => {
        const rank = i + 1;
        const line = entryLine(entry);
        const isSelected = sameLine(line, selected);
        const isPlayer = playerRank === rank;
        return (
          <button
            key={rank}
            type="button"
            data-testid="combo-row"
            data-rank={rank}
            aria-pressed={isSelected}
            className={`combo-row${isSelected ? ' is-selected' : ''}${isPlayer ? ' is-player' : ''}`}
            onClick={() => onSelect(line)}
          >
            <span className="combo-rank">{ordinal(rank)}</span>
            <span className="combo-score">{formatScore(entry.score)}</span>
            {isPlayer ? <span className="combo-you">You</span> : null}
          </button>
        );
      })}

      {/* The player's combo, when it is not already highlighted in the top-5. */}
      {!playerInTop && playerLine ? (
        <button
          type="button"
          data-testid="combo-your-move"
          aria-pressed={sameLine(playerLine, selected)}
          className={`combo-row combo-yours${sameLine(playerLine, selected) ? ' is-selected' : ''}`}
          onClick={() => onSelect(playerLine)}
        >
          <span className="combo-rank">Your move</span>
          <span className="combo-score">
            {playerRank !== null && playerScore !== null
              ? `${ordinal(playerRank)} · ${formatScore(playerScore)}`
              : 'too low to rank'}
          </span>
        </button>
      ) : null}
    </div>
  );
}
