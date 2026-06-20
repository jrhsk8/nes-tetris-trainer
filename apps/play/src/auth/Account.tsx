/**
 * Account (#13) — the signed-in shell: shows who is signed in, their rating
 * history, and the play loop. The history refreshes each time a new puzzle is
 * loaded, so a rating change from the previous attempt is reflected.
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

export function Account({ db, user, auth }: AccountProps) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [rating, setRating] = useState<number>(seedRating().rating);

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
        <span data-testid="account-email">{user.email ?? 'Signed in'}</span>
        <button type="button" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </header>
      <RatingHistory currentRating={rating} attempts={attempts} />
      <PuzzlePlay db={db} userId={user.id} onAdvance={() => void refresh()} />
    </div>
  );
}
