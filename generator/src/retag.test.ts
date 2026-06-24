import { describe, it, expect } from 'vitest';
import { computeRetag, type BankRow } from './retag.js';

/**
 * Re-tag migration core (#83). `computeRetag` recomputes each row's tags purely
 * from its STORED board + pieces + combo table — no DB, no engine — so the live
 * migration is deterministic and idempotent. These fixtures exercise the row
 * handling (a taggable row, a legacy row, a malformed row) and the idempotency
 * invariant without touching Supabase.
 */

// A real empty-board O,O stored row: the rank-1 line stacks two O's cleanly, so
// it tags `clean-stacking`. The boardKey is the post-line decode the tagger needs.
const emptyKey = '0'.repeat(200);

/** A stored row whose rank-1 entry resolves to a clean two-O stack. */
function cleanStackRow(id: string): BankRow {
  // Two O's dropped on an empty board: bottom rows partially filled, no clears.
  // boardKey = the board AFTER both placements (O at cols 0-1 rows 18-19, O at
  // cols 2-3 rows 18-19) — a clean stack (no full row, no holes).
  let after = emptyKey.split('');
  const setCell = (r: number, c: number) => (after[r * 10 + c] = '1');
  for (const [r, c] of [
    [18, 0], [18, 1], [19, 0], [19, 1],
    [18, 2], [18, 3], [19, 2], [19, 3],
  ] as const) {
    setCell(r, c);
  }
  const board2 = after.join('');
  return {
    id,
    board: emptyKey,
    piece1: 'O',
    piece2: 'O',
    tags: null,
    combos: {
      total: 1,
      entries: [
        { rot1: 0, col1: 0, rot2: 0, col2: 2, score: 100, boardKey: board2 },
      ],
    } as BankRow['combos'],
  };
}

describe('computeRetag (#83 re-tag migration core)', () => {
  it('re-tags a fixture bank deterministically', () => {
    const rows = [cleanStackRow('p1')];
    const { updates, perTag, taggedPuzzles, failures } = computeRetag(rows);

    expect(failures).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('p1');
    expect(updates[0].tags).toContain('clean-stacking');
    expect(taggedPuzzles).toBe(1);
    expect(perTag.get('clean-stacking')).toBe(1);
  });

  it('is idempotent — the same rows yield the same tags', () => {
    const rows = [cleanStackRow('p1'), cleanStackRow('p2')];
    const first = computeRetag(rows);
    const second = computeRetag(rows);
    expect(second.updates).toEqual(first.updates);
    expect([...second.perTag]).toEqual([...first.perTag]);

    // Re-running after the tags were written back changes nothing (the input the
    // tagger reads — board/pieces/combos — is untouched by the tag write).
    const written = rows.map((r, i) => ({ ...r, tags: first.updates[i].tags }));
    expect(computeRetag(written).updates).toEqual(first.updates);
  });

  it('skips legacy/malformed rows (no combos, or invalid pieces) without crashing', () => {
    const noCombos: BankRow = { id: 'legacy', board: emptyKey, piece1: 'O', piece2: 'O', tags: null, combos: { total: 0, entries: [] } as BankRow['combos'] };
    const badPiece: BankRow = { ...cleanStackRow('bad'), piece1: 'X' };
    const { updates, failures } = computeRetag([noCombos, badPiece, cleanStackRow('ok')]);

    expect(failures).toBe(2); // the two unusable rows are skipped, not updated
    expect(updates.map((u) => u.id)).toEqual(['ok']);
  });

  it('best-effort on legacy rows: a hard-drop line still tags without a boardKey', () => {
    const row = cleanStackRow('nokey');
    // Strip the boardKey: a legacy combo row with no stored outcome board (#83).
    // A hard-drop placement is reconstructed from (rotation, col) alone — only a
    // tuck/spin's deeper resting row needs the boardKey — so this clean O,O stack
    // still recovers its line and tags `clean-stacking`.
    row.combos!.entries[0] = { ...row.combos!.entries[0], boardKey: undefined };
    const { updates, failures } = computeRetag([row]);
    expect(failures).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].tags).toContain('clean-stacking');
  });
});
