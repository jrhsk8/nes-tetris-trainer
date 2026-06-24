/**
 * Curation analytics by type (#87) — an admin-only, bank-wide table that helps
 * the curator pattern-mine which puzzle TYPES underperform (e.g. "spin puzzles
 * get culled 3x more"). One row per type-tag with its flag rate, cull rate, and
 * average stars, aggregated over EVERY user via the SECURITY DEFINER
 * `curation_tag_stats` aggregate (no individual row exposed).
 *
 * Like the per-puzzle {@link Curation} controls, this REVEALS only when the
 * signed-in account is an admin (verified, non-anonymous, allowlisted email,
 * #78), self-detected via {@link CurationAnalyticsDb.isAdmin}. For everyone else
 * it renders nothing and never fetches — normal play is unaffected.
 */

import { useEffect, useState } from 'react';
import type { CurationTagStat, DataAccess } from '@trainer/data';
import { TAG_VOCAB } from '../tags/tagVocab.js';

/** The slice of the data access the analytics panel needs. */
export type CurationAnalyticsDb = Pick<DataAccess, 'isAdmin' | 'getCurationTagStats'>;

export interface CurationAnalyticsProps {
  db: CurationAnalyticsDb;
}

/** A flag/cull rate as a per-puzzle ratio, formatted (e.g. `0.40`), or `—`. */
function rate(count: number, puzzles: number): string {
  if (puzzles === 0) return '—';
  return (count / puzzles).toFixed(2);
}

export function CurationAnalytics({ db }: CurationAnalyticsProps) {
  const [admin, setAdmin] = useState<boolean>(false);
  const [stats, setStats] = useState<CurationTagStat[] | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!(await db.isAdmin())) {
          if (active) setAdmin(false);
          return;
        }
        if (active) setAdmin(true);
        const rows = await db.getCurationTagStats();
        if (active) setStats(rows);
      } catch {
        if (active) setAdmin(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [db]);

  if (!admin) return null;

  return (
    <section className="curation-analytics" aria-label="curation analytics by type">
      <p className="curation-label">Type analytics</p>
      {stats === null ? (
        <p>Loading…</p>
      ) : stats.length === 0 ? (
        <p>No tagged puzzles yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Puzzles</th>
              <th scope="col">Flag rate</th>
              <th scope="col">Cull rate</th>
              <th scope="col">Avg stars</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.tag} data-testid={`tag-stat-${s.tag}`}>
                <th scope="row">{TAG_VOCAB[s.tag]?.label ?? s.tag}</th>
                <td>{s.puzzleCount}</td>
                <td>{rate(s.flagCount, s.puzzleCount)}</td>
                <td>{rate(s.cullCount, s.puzzleCount)}</td>
                <td>{s.ratingCount > 0 ? s.avgStars.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
