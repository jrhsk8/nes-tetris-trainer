/**
 * Per-type accuracy panel (#86): the player's own rated attempts, broken down by
 * puzzle type and sorted weakest-first, so they can see which types to drill.
 * Renders a zero state when the player has no tagged rated attempts yet.
 */

import { perTypeStats, type TaggedAttempt } from './tagStats.js';
import { TAG_VOCAB } from './tagVocab.js';

export function PerTypeStats({ attempts }: { attempts: readonly TaggedAttempt[] }) {
  const stats = perTypeStats(attempts);

  return (
    <section className="per-type-stats" data-testid="per-type-stats" aria-label="accuracy by type">
      <h2 className="per-type-title">Accuracy by type</h2>
      {stats.length === 0 ? (
        <p data-testid="per-type-empty">No rated attempts yet — play some puzzles to see your weak types.</p>
      ) : (
        <table className="per-type-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Attempts</th>
              <th scope="col">Solve&nbsp;rate</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.tag} data-tag={s.tag}>
                <td>{TAG_VOCAB[s.tag].label}</td>
                <td>{s.attempts}</td>
                <td>{Math.round(s.solveRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
