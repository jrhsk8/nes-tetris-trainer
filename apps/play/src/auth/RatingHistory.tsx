/**
 * RatingHistory (#13) — shows the player's current rating and its trend over
 * past attempts, so they can confirm they are improving (user story 15). Pure
 * presentational: the rating points come from each attempt's `ratingAfter`.
 */

import type { Attempt } from '@trainer/data';

export interface RatingHistoryProps {
  currentRating: number;
  attempts: readonly Attempt[];
}

/** A tiny inline SVG sparkline of the rating values over time. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 160;
  const height = 40;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      data-testid="rating-trend"
      width={width}
      height={height}
      role="img"
      aria-label="rating trend"
    >
      <polyline points={points} fill="none" stroke="#4a90d9" strokeWidth={2} />
    </svg>
  );
}

export function RatingHistory({ currentRating, attempts }: RatingHistoryProps) {
  const points = attempts
    .map((a) => a.ratingAfter)
    .filter((r): r is number => r !== null && r !== undefined);

  return (
    <section aria-label="rating">
      <p>
        Your rating: <strong data-testid="current-rating">{Math.round(currentRating)}</strong>
      </p>
      <p data-testid="attempt-count">{attempts.length} attempts</p>
      {points.length >= 2 ? (
        <Sparkline values={points} />
      ) : (
        <p>Play a few puzzles to see your rating trend.</p>
      )}
    </section>
  );
}
