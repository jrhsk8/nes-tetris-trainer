/**
 * Star rating control (#80) — a clickable 1–5 star "How fun was this puzzle?"
 * rating shown in results. One rating per user per puzzle, changeable (upsert);
 * anonymous players may rate. The community AVERAGE is deliberately HIDDEN until
 * the player submits their own rating (so the crowd score can't anchor the
 * subjective judgement), then revealed live as `avg ★ (N)`.
 *
 * Stars express quality / fun, NOT difficulty (that is the rating + correct-%).
 * They are the crowd substrate for a future auto-"interestingness" curation gate.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DataAccess } from '@trainer/data';

/** The persistence the star control needs. */
export type StarDb = Pick<DataAccess, 'upsertStarRating' | 'getMyStarRating' | 'getStarStats'>;

export interface StarRatingProps {
  db: StarDb;
  userId: string;
  puzzleId: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

export function StarRating({ db, userId, puzzleId }: StarRatingProps) {
  // null = not rated yet (community stats stay hidden); a number = the player's
  // own rating (stats revealed).
  const [myStars, setMyStars] = useState<number | null>(null);
  const [stats, setStats] = useState<{ avg: number; count: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // On mount, load any existing rating; if the player already rated this puzzle
  // (e.g. on a re-serve), reveal the community stats straight away.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const mine = await db.getMyStarRating(userId, puzzleId);
        if (!live) return;
        if (mine != null) {
          setMyStars(mine);
          setStats(await db.getStarStats(puzzleId));
        }
      } catch {
        // Best-effort: a load hiccup just leaves the control unrated.
      }
    })();
    return () => {
      live = false;
    };
  }, [db, userId, puzzleId]);

  const rate = useCallback(
    async (stars: number) => {
      setMyStars(stars); // optimistic — the upsert reconciles the row
      try {
        await db.upsertStarRating(userId, puzzleId, stars);
        // Reveal the live community average (now including this rating).
        setStats(await db.getStarStats(puzzleId));
      } catch {
        // Leave the optimistic selection; the next attempt can retry.
      }
    },
    [db, userId, puzzleId],
  );

  const filledTo = hover ?? myStars ?? 0;

  return (
    <div className="star-rating" data-testid="star-rating">
      <p className="star-rating-prompt">How fun was this puzzle?</p>
      <div role="radiogroup" aria-label="How fun was this puzzle?">
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            className={`star ${n <= filledTo ? 'is-filled' : ''}`}
            role="radio"
            aria-checked={myStars === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            data-testid={`star-${n}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            onClick={() => void rate(n)}
          >
            {n <= filledTo ? '★' : '☆'}
          </button>
        ))}
      </div>
      {/* Community average — revealed only AFTER the player has rated (#80). */}
      {myStars != null && stats ? (
        <p className="star-rating-community" data-testid="star-community">
          {stats.avg.toFixed(1)} ★ ({stats.count})
        </p>
      ) : null}
    </div>
  );
}
