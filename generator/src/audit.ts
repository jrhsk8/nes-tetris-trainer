/**
 * Bank-wide rank-1 outcome-quality audit (#50). Reads every stored puzzle's
 * combo table, decodes each combo's resulting-board `boardKey`, and reports
 * rank-1 boards that are bad relative to a lower-ranked stored combo on the SAME
 * puzzle (all combos share board0, so holes/height are directly comparable):
 *
 *  - `egregious-holey` — a no-taller stored combo buries ≥ `holeMargin` fewer
 *    holes than rank-1 (the holey-optimal bug).
 *  - `tower` — rank-1 is ≥ `towerMinHeight` tall with a ≥ `towerHeightMargin`
 *    shorter stored alternative.
 *  - `mild-dominated` — rank-1 beaten by ≥ 2 on holes or height (reported for
 *    transparency; NOT a defect — the engine eval legitimately trades a little
 *    height for board shape, see .claude/docs/decisions.md 2026-06-21 #50).
 *
 * Acceptance (#50): a regenerated bank has ZERO `egregious-holey` and ZERO
 * `tower` rank-1 boards. Run offline with the service key:
 *
 *   npx tsx generator/src/audit.ts
 */

import { boardMetrics, decodeBoard } from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';
import type { ComboTable } from '@trainer/data';
import { DEFAULT_RANK1_QUALITY } from './pipeline/combo.js';

interface Clean {
  holes: number;
  maxHeight: number;
}

function cleanOf(boardKey: string): Clean {
  const m = boardMetrics(decodeBoard(boardKey));
  return { holes: m.holes, maxHeight: m.columnHeights.length ? Math.max(...m.columnHeights) : 0 };
}

/** Classify a puzzle's rank-1 board against its lower-ranked stored combos. */
export function auditRank1(
  combos: ComboTable,
  config = DEFAULT_RANK1_QUALITY,
): 'ok' | 'egregious-holey' | 'tower' | 'mild-dominated' | 'no-keys' {
  const keyed = combos.entries.filter((e) => typeof e.boardKey === 'string');
  if (keyed.length === 0) return 'no-keys';
  const cb = cleanOf(keyed[0].boardKey!);
  const others = keyed.slice(1).map((e) => cleanOf(e.boardKey!));
  if (others.some((c) => c.maxHeight <= cb.maxHeight && cb.holes - c.holes >= config.holeMargin)) {
    return 'egregious-holey';
  }
  if (
    cb.maxHeight >= config.towerMinHeight &&
    others.some((c) => c.maxHeight <= cb.maxHeight - config.towerHeightMargin)
  ) {
    return 'tower';
  }
  if (others.some((c) => cb.holes - c.holes >= 2 || cb.maxHeight - c.maxHeight >= 2)) {
    return 'mild-dominated';
  }
  return 'ok';
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  const client = createSupabaseClient(supabaseUrl, serviceKey);
  const { data, error } = await client.from('puzzles').select('id, combos');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; combos: ComboTable | null }[];

  const tally: Record<string, number> = {};
  const bad: { id: string; kind: string }[] = [];
  for (const row of rows) {
    const verdict = row.combos ? auditRank1(row.combos) : 'no-keys';
    tally[verdict] = (tally[verdict] ?? 0) + 1;
    if (verdict === 'egregious-holey' || verdict === 'tower') {
      bad.push({ id: row.id, kind: verdict });
    }
  }

  console.log(`Audited ${rows.length} puzzles.`);
  for (const [kind, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }
  if (bad.length > 0) {
    console.log('\nEGREGIOUS rank-1 boards (acceptance requires ZERO):');
    for (const b of bad) console.log(`  ${b.id}: ${b.kind}`);
    process.exitCode = 1;
  } else {
    console.log('\nPASS: zero egregious-holey and zero tower rank-1 boards.');
  }
}

// Run as a CLI (skip when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
