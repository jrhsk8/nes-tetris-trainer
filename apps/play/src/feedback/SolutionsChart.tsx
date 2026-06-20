/**
 * Solutions strip-plot (#29) — replaces the geometric-metrics table in the
 * feedback view (docs/glossary.md "Solutions chart"). For one ply it plots the
 * engine's value for every legal placement on a single 0–100 axis: each
 * alternative is a dot, the optimal placement is pinned at the top (100), and
 * the player's placement is marked with a "rank N of M" callout. It reads only
 * the value table the bank stored (#27) — no engine call at play time.
 *
 * The axis is field-normalised from the table's worst value (0) to the optimal
 * value (100), so the spread of dots shows how close the alternatives were.
 */

import type { Placement } from '@trainer/core';
import type { PlacementValue } from '@trainer/data';

export interface SolutionsChartProps {
  /** Heading for this ply, e.g. "First piece (T)". */
  label: string;
  /** The value table: every legal placement of this ply's piece + its value. */
  values: readonly PlacementValue[];
  /** The optimal placement for this ply (pinned at the top of the axis). */
  optimal: Placement;
  /** The placement the player made for this ply, if any. */
  player?: Placement;
}

type Cell = { rotation: number; col: number };

const same = (a: Cell, b: Cell) => a.rotation === b.rotation && a.col === b.col;

/** "1st", "2nd", "3rd", "4th", … */
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

export function SolutionsChart({ label, values, optimal, player }: SolutionsChartProps) {
  // Best-first, so the rank of a placement is its 1-based index here.
  const sorted = [...values].sort((a, b) => b.value - a.value);
  const count = sorted.length;

  // Normalise from the worst value (0) to the optimal value (100); a rare
  // alternative scoring above the stored optimal clamps to 100.
  const optimalEntry = values.find((v) => same(v, optimal));
  const top = optimalEntry ? optimalEntry.value : count > 0 ? sorted[0].value : 0;
  const bottom = count > 0 ? sorted[count - 1].value : 0;
  const span = top - bottom;
  const axis = (v: number) =>
    span > 0 ? Math.max(0, Math.min(100, ((v - bottom) / span) * 100)) : 100;

  const playerEntry = player ? values.find((v) => same(v, player)) : undefined;
  const playerRank = playerEntry ? sorted.findIndex((v) => same(v, playerEntry)) + 1 : null;

  return (
    <figure
      className="solutions-chart"
      data-testid="solutions-chart"
      aria-label={`solutions for ${label}`}
    >
      <figcaption className="solutions-chart-label">{label}</figcaption>
      <div
        className="strip-track"
        data-testid="strip-track"
        role="img"
        aria-label={`${count} placements ranked by engine value; optimal at the top`}
        style={{ position: 'relative' }}
      >
        {sorted.map((v) => {
          const isOptimal = same(v, optimal);
          const isPlayer = playerEntry !== undefined && same(v, playerEntry);
          return (
            <span
              key={`${v.rotation}-${v.col}`}
              className={`strip-dot${isOptimal ? ' is-optimal' : ''}${isPlayer ? ' is-player' : ''}`}
              data-testid="strip-dot"
              style={{ position: 'absolute', left: `${axis(v.value)}%` }}
            />
          );
        })}
        {/* Distinct, queryable rings over the optimal and player placements. */}
        {optimalEntry ? (
          <span
            data-testid="strip-dot-optimal"
            className="strip-marker is-optimal"
            style={{ position: 'absolute', left: `${axis(optimalEntry.value)}%` }}
          />
        ) : null}
        {playerEntry && !same(playerEntry, optimal) ? (
          <span
            data-testid="strip-dot-player"
            className="strip-marker is-player"
            style={{ position: 'absolute', left: `${axis(playerEntry.value)}%` }}
          />
        ) : null}
      </div>
      <p className="strip-rank" data-testid="strip-rank">
        {playerRank !== null
          ? `Your move: ${ordinal(playerRank)} of ${count}`
          : player
            ? `Your move was not among the ${count} ranked placements`
            : `Optimal of ${count} placements`}
      </p>
    </figure>
  );
}
