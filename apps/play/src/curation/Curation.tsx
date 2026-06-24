/**
 * In-play admin controls (#72, #78) — the human "is it fun?" pass on top of the
 * auto gates, done while playing normally. Two actions for an email-allowlisted
 * admin:
 *
 *  - **Flag** — attach a free-text comment to the append-only `puzzle_flags` log
 *    (for later pattern-mining of what makes puzzles boring). The puzzle stays
 *    live.
 *  - **Cull** — soft-delete: log a `cull` row and set `active = false`, so
 *    matchmaking stops serving the puzzle. Reversible via an Undo toast.
 *
 * Gating is enforced in Supabase RLS (a cull mutates the shared bank), NOT
 * trusted from here. This component only REVEALS the controls when the signed-in
 * account is an admin — a verified, non-anonymous, allowlisted email (#78),
 * self-detected via {@link CurationDb.isAdmin}. With no email allowlisted,
 * `isAdmin` is false and this renders nothing — normal play is unaffected.
 */

import { useEffect, useState } from 'react';
import type { DataAccess } from '@trainer/data';

/** The slice of the data access the admin controls need. */
export type CurationDb = Pick<
  DataAccess,
  'isAdmin' | 'flagPuzzle' | 'cullPuzzle' | 'setPuzzleActive'
>;

export interface CurationProps {
  db: CurationDb;
  userId: string;
  puzzleId: string;
}

export function Curation({ db, userId, puzzleId }: CurationProps) {
  const [admin, setAdmin] = useState<boolean>(false);
  const [flagging, setFlagging] = useState(false);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [culled, setCulled] = useState(false);

  // Self-detect admin status (RLS-backed). Reset per puzzle so the controls
  // reflect the puzzle currently in view.
  useEffect(() => {
    let active = true;
    setFlagging(false);
    setComment('');
    setStatus(null);
    setCulled(false);
    void (async () => {
      try {
        const ok = await db.isAdmin();
        if (active) setAdmin(ok);
      } catch {
        if (active) setAdmin(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [db, userId, puzzleId]);

  if (!admin) return null;

  const submitFlag = async () => {
    const text = comment.trim();
    if (!text) return;
    try {
      await db.flagPuzzle({ puzzleId, userId, comment: text });
      setStatus('Flagged.');
      setFlagging(false);
      setComment('');
    } catch {
      setStatus('Flag failed.');
    }
  };

  const cull = async () => {
    try {
      await db.cullPuzzle({ puzzleId, userId, reason: comment.trim() || undefined });
      setCulled(true);
      setStatus(null);
    } catch {
      setStatus('Cull failed.');
    }
  };

  const undoCull = async () => {
    try {
      await db.setPuzzleActive(puzzleId, true);
      setCulled(false);
      setStatus('Restored.');
    } catch {
      setStatus('Undo failed.');
    }
  };

  return (
    <section className="curation" aria-label="admin">
      <p className="curation-label">Admin</p>
      {culled ? (
        <div className="curation-toast" role="status">
          <span>Culled — hidden from play.</span>
          <button type="button" onClick={() => void undoCull()}>
            Undo
          </button>
        </div>
      ) : flagging ? (
        <div className="curation-flag">
          <label>
            Why is it boring?
            <input
              type="text"
              aria-label="flag comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div className="curation-actions">
            <button type="button" onClick={() => void submitFlag()} disabled={!comment.trim()}>
              Save flag
            </button>
            <button type="button" onClick={() => setFlagging(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="curation-actions">
          <button type="button" onClick={() => setFlagging(true)}>
            Flag
          </button>
          <button type="button" className="curation-cull" onClick={() => void cull()}>
            Cull
          </button>
        </div>
      )}
      {status ? <p className="curation-status">{status}</p> : null}
    </section>
  );
}
