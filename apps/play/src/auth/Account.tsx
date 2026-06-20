/**
 * Account (#13) — the signed-in shell: shows who is signed in and switches
 * between the Play / History / Controls views via a simple in-app header nav
 * (#22, no router). The history refreshes each time a new puzzle is loaded, so
 * a rating change from the previous attempt is reflected.
 *
 * The Play view is a flanking dashboard: the rating panel rides the left rail
 * (threaded into the play screen via `leftFlank`), the board is the centred
 * hero, and the right rail carries the next-piece box / result chart. The
 * History and Controls views are wired here but filled in by their own issues
 * (#26 history, #24 controls).
 */

import { useCallback, useEffect, useState } from 'react';
import type { Attempt, DataAccess } from '@trainer/data';
import { seedRating } from '@trainer/rating';
import { PuzzlePlay, type PlayDb } from '../session/index.js';
import type { AuthApi, AuthUser } from './auth.js';
import { RatingHistory } from './RatingHistory.js';

/** The persistence the account view needs (play loop + history reads). */
export type AccountDb = PlayDb & Pick<DataAccess, 'getUserAttempts'>;

export interface AccountProps {
  db: AccountDb;
  user: AuthUser;
  auth: AuthApi;
}

type View = 'play' | 'history' | 'controls';

const NAV: { view: View; label: string }[] = [
  { view: 'play', label: 'Play' },
  { view: 'history', label: 'History' },
  { view: 'controls', label: 'Controls' },
];

export function Account({ db, user, auth }: AccountProps) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [rating, setRating] = useState<number>(seedRating().rating);
  const [view, setView] = useState<View>('play');

  const refresh = useCallback(async () => {
    try {
      const [history, userRating] = await Promise.all([
        db.getUserAttempts(user.id),
        db.getUserRating(user.id),
      ]);
      setAttempts(history);
      setRating(userRating?.rating ?? seedRating().rating);
    } catch {
      // A read failure (e.g. transient) leaves the last-known values in place.
    }
  }, [db, user.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="account">
      <header className="account-header">
        <nav className="app-nav" aria-label="views">
          {NAV.map(({ view: v, label }) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'nav-active' : undefined}
              aria-current={view === v ? 'page' : undefined}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span data-testid="account-email">{user.email ?? 'Signed in'}</span>
        <button type="button" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </header>

      {view === 'play' ? (
        <div data-testid="view-play">
          <PuzzlePlay
            db={db}
            userId={user.id}
            onAdvance={() => void refresh()}
            leftFlank={<RatingHistory currentRating={rating} attempts={attempts} />}
          />
        </div>
      ) : view === 'history' ? (
        <section data-testid="view-history" aria-label="history">
          <h2>History</h2>
          <p>Your past attempts will appear here.</p>
        </section>
      ) : (
        <section data-testid="view-controls" aria-label="controls">
          <h2>Controls</h2>
          <p>Key bindings will be configurable here.</p>
        </section>
      )}
    </div>
  );
}
