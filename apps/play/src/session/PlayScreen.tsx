/**
 * PlayScreen (#22) — the flanking-dashboard shell for the Play view. A three
 * column grid: a left rail (rating + on-screen controls), the centred board
 * hero, and a right rail (next-piece box while solving / result + chart after
 * an attempt). The board is always the centre column and never moves between
 * phases; only the rail contents change.
 *
 * Below ~900px the grid collapses to a single stacked column (see styles.css).
 * Every rail/cell clips its children, so a chart or table can never spill past
 * a panel border.
 */

import type { ReactNode } from 'react';

export interface PlayScreenProps {
  /** Left rail content — the rating panel (and, later, on-screen controls). */
  leftFlank?: ReactNode;
  /**
   * Centre + right columns. Callers supply a centre cell (`.play-center`, with
   * `data-testid="board-center"`) and an optional right rail
   * (`role="complementary"`). The {@link Feedback} view uses `display: contents`
   * to drop its own board + result panel straight into these two columns.
   */
  children: ReactNode;
}

export function PlayScreen({ leftFlank, children }: PlayScreenProps) {
  return (
    <div className="play-screen" aria-label="play screen">
      <aside className="flank flank-left" aria-label="rating rail">
        {leftFlank}
      </aside>
      {children}
    </div>
  );
}
