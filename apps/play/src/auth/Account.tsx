/**
 * Account (#13) — the signed-in shell: shows who is signed in and switches
 * between the Play / History / Controls views via a simple in-app header nav
 * (#22, no router). The history refreshes each time a new puzzle is loaded, so
 * a rating change from the previous attempt is reflected.
 *
 * The Play view is a flanking dashboard: the rating panel rides the left rail
 * (threaded into the play screen via `leftFlank`), the board is the centred
 * hero, and the right rail carries the next-piece box / result chart. The
 * Controls view (#24) edits the player's key bindings, loaded from and synced
 * to Supabase prefs and threaded into the placement input; the History view
 * (#26) lists past attempts and re-opens each read-only in the Feedback view.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Attempt, DataAccess } from '@trainer/data';
import { seedRating } from '@trainer/rating';
import { PuzzlePlay, type PlayDb } from '../session/index.js';
import { Controls } from '../controls/index.js';
import { History } from '../history/index.js';
import { SubmitScreenshot } from '../submit/index.js';
import { DEFAULT_BINDINGS, sanitizeBindings, type KeyBindings } from '../board/keybindings.js';
import { WORDMARK } from '../branding.js';
import { parsePuzzleParam } from '../share.js';
import type { AuthApi, AuthUser } from './auth.js';
import { RatingHistory } from './RatingHistory.js';

/** The persistence the account view needs (play loop + history + prefs). */
export type AccountDb = PlayDb &
  Pick<
    DataAccess,
    | 'getUserAttempts'
    | 'getUserAttemptHistory'
    | 'getPuzzle'
    | 'getUserPrefs'
    | 'upsertUserPrefs'
    | 'uploadSubmissionImage'
    | 'insertSubmission'
  >;

export interface AccountProps {
  db: AccountDb;
  user: AuthUser;
  auth: AuthApi;
}

type View = 'play' | 'history' | 'controls' | 'submit';

const NAV: { view: View; label: string }[] = [
  { view: 'play', label: 'Play' },
  { view: 'history', label: 'History' },
  { view: 'controls', label: 'Controls' },
  { view: 'submit', label: 'Submit' },
];

export function Account({ db, user, auth }: AccountProps) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [rating, setRating] = useState<number>(seedRating().rating);
  const [bindings, setBindings] = useState<KeyBindings>(DEFAULT_BINDINGS);
  const [muted, setMuted] = useState<boolean>(false); // sound on by default (#61)
  const [view, setView] = useState<View>('play');
  // A `?puzzle=N` share link (#49) opens that exact puzzle first; read once.
  const sharedPuzzleNumber = useMemo(
    () => (typeof window !== 'undefined' ? parsePuzzleParam(window.location.search) : null),
    [],
  );

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

  // Load the player's saved prefs once on sign-in; fall back to defaults.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const prefs = await db.getUserPrefs(user.id);
        if (active) {
          setBindings(sanitizeBindings(prefs?.bindings));
          setMuted(prefs?.muted ?? false);
        }
      } catch {
        // Prefs unavailable — keep the defaults so play stays usable.
      }
    })();
    return () => {
      active = false;
    };
  }, [db, user.id]);

  // Apply a rebind immediately and persist it (synced across devices); the mute
  // pref rides the same row, so persist it alongside.
  const changeBindings = useCallback(
    (next: KeyBindings) => {
      setBindings(next);
      void db.upsertUserPrefs({ userId: user.id, bindings: next, muted }).catch(() => {
        // Persistence failed — the in-memory binding still took effect.
      });
    },
    [db, user.id, muted],
  );

  // Toggle the result-sound mute and persist it (alongside the bindings, #61).
  const changeMuted = useCallback(
    (next: boolean) => {
      setMuted(next);
      void db.upsertUserPrefs({ userId: user.id, bindings, muted: next }).catch(() => {
        // Persistence failed — the in-memory toggle still took effect.
      });
    },
    [db, user.id, bindings],
  );

  return (
    <div className="account">
      <header className="top-bar">
        <span className="wordmark">{WORDMARK}</span>
        <div className="top-bar-end">
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
        </div>
      </header>

      {view === 'play' ? (
        <div data-testid="view-play">
          <PuzzlePlay
            db={db}
            userId={user.id}
            initialPuzzleNumber={sharedPuzzleNumber}
            onAdvance={() => void refresh()}
            leftFlank={<RatingHistory currentRating={rating} attempts={attempts} />}
            bindings={bindings}
            muted={muted}
          />
        </div>
      ) : view === 'history' ? (
        <History db={db} userId={user.id} />
      ) : view === 'controls' ? (
        <Controls
          bindings={bindings}
          onChange={changeBindings}
          muted={muted}
          onMutedChange={changeMuted}
        />
      ) : (
        <SubmitScreenshot db={db} userId={user.id} isAnonymous={user.isAnonymous} />
      )}
    </div>
  );
}
