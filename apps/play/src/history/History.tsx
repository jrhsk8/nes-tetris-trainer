/**
 * History view (#26) — a sortable, filterable, paginated list of the player's
 * past attempts. Difficulty is not stored on the attempt; it is joined from the
 * puzzle (`getUserAttemptHistory`). Clicking a row re-opens that puzzle read-
 * only in the {@link Feedback} view (board + animated optimal line + the
 * player's move's metric deltas). An attempt whose puzzle no longer exists
 * (orphaned by a bank regen) is shown but not re-openable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { decodeBoard } from '@trainer/core';
import type { AttemptHistoryEntry, DataAccess, Puzzle } from '@trainer/data';
import { Feedback } from '../feedback/index.js';

/** The persistence the history view needs. */
export type HistoryDb = Pick<DataAccess, 'getUserAttemptHistory' | 'getPuzzle'>;

export interface HistoryProps {
  db: HistoryDb;
  userId: string;
}

type SortKey = 'date' | 'difficulty' | 'result';
type SortDir = 'asc' | 'desc';
type ResultFilter = 'all' | 'solved' | 'failed';

const PAGE_SIZE = 8;

/** Filter + sort the entries for display (pure, for predictable ordering). */
function arrange(
  entries: AttemptHistoryEntry[],
  filter: ResultFilter,
  key: SortKey,
  dir: SortDir,
): AttemptHistoryEntry[] {
  const filtered = entries.filter((e) =>
    filter === 'all' ? true : filter === 'solved' ? e.solved : !e.solved,
  );
  const sign = dir === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    let cmp: number;
    if (key === 'date') {
      cmp = a.createdAt.localeCompare(b.createdAt);
    } else if (key === 'difficulty') {
      // Orphaned (null) difficulties sort to the end regardless of direction.
      const av = a.difficulty;
      const bv = b.difficulty;
      if (av === null && bv === null) cmp = 0;
      else if (av === null) return 1;
      else if (bv === null) return -1;
      else cmp = av - bv;
    } else {
      cmp = Number(a.solved) - Number(b.solved);
    }
    return cmp * sign;
  });
}

export function History({ db, userId }: HistoryProps) {
  const [entries, setEntries] = useState<AttemptHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const [review, setReview] = useState<{ puzzle: Puzzle; attempt: AttemptHistoryEntry } | null>(
    null,
  );
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const history = await db.getUserAttemptHistory(userId);
        if (active) setEntries(history);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load history');
      }
    })();
    return () => {
      active = false;
    };
  }, [db, userId]);

  const arranged = useMemo(
    () => (entries ? arrange(entries, filter, sortKey, sortDir) : []),
    [entries, filter, sortKey, sortDir],
  );

  const pageCount = Math.max(1, Math.ceil(arranged.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const visible = arranged.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const sortBy = useCallback((key: SortKey) => {
    setPage(0);
    setSortKey((prevKey) => {
      setSortDir((prevDir) => (prevKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'desc'));
      return key;
    });
  }, []);

  const open = useCallback(
    async (attempt: AttemptHistoryEntry) => {
      setOpening(attempt.id);
      try {
        const puzzle = await db.getPuzzle(attempt.puzzleId);
        if (puzzle) setReview({ puzzle, attempt });
      } catch {
        // A transient failure leaves the list in place; the user can retry.
      } finally {
        setOpening(null);
      }
    },
    [db],
  );

  if (review) {
    const { puzzle, attempt } = review;
    return (
      <section data-testid="view-history" aria-label="history">
        <div className="history-review-bar">
          <button type="button" onClick={() => setReview(null)}>
            ← Back to history
          </button>
          <span className="history-review-result">{attempt.solved ? 'Solved' : 'Failed'}</span>
        </div>
        <Feedback
          board0={decodeBoard(puzzle.board)}
          piece1={puzzle.piece1}
          piece2={puzzle.piece2}
          optimalLine={puzzle.optimalLine}
          optimalMetrics={puzzle.optimalMetrics}
          userLine={attempt.userLine}
          solved={attempt.solved}
        />
      </section>
    );
  }

  return (
    <section data-testid="view-history" aria-label="history">
      <h2>History</h2>

      {error ? <p role="alert">Could not load history: {error}</p> : null}

      <div className="history-controls">
        <label>
          Result:{' '}
          <select
            aria-label="Filter by result"
            value={filter}
            onChange={(e) => {
              setPage(0);
              setFilter(e.target.value as ResultFilter);
            }}
          >
            <option value="all">All</option>
            <option value="solved">Solved</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>

      {entries === null ? (
        <p>Loading history…</p>
      ) : arranged.length === 0 ? (
        <p>No attempts yet.</p>
      ) : (
        <>
          <table className="history-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => sortBy('date')}>
                    Date{sortKey === 'date' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => sortBy('difficulty')}>
                    Difficulty{sortKey === 'difficulty' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => sortBy('result')}>
                    Result{sortKey === 'result' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th aria-label="open" />
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                const orphaned = entry.difficulty === null;
                return (
                  <tr key={entry.id} data-testid="history-row">
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{orphaned ? '—' : Math.round(entry.difficulty!)}</td>
                    <td data-testid="history-result">{entry.solved ? 'Solved' : 'Failed'}</td>
                    <td>
                      <button
                        type="button"
                        aria-label="Review attempt"
                        disabled={orphaned || opening === entry.id}
                        title={
                          orphaned
                            ? 'This puzzle no longer exists and cannot be reopened.'
                            : undefined
                        }
                        onClick={() => void open(entry)}
                      >
                        {opening === entry.id ? 'Opening…' : 'Review'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="history-pager">
            <button
              type="button"
              disabled={clampedPage === 0}
              onClick={() => setPage(clampedPage - 1)}
            >
              Previous
            </button>
            <span data-testid="history-page">
              Page {clampedPage + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={clampedPage >= pageCount - 1}
              onClick={() => setPage(clampedPage + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
