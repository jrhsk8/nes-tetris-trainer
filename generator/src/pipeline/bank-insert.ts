/**
 * The shared tail of every constructive maneuver generator: gate the assembled
 * survivors on BetaTetris consensus, then insert the kept puzzles into the bank
 * (or, under `--dry-run`, just report them).
 *
 * The six strict generators (spin / forced-spin / forced-sz-dig / spintuck /
 * varied / tuck) each repeated this block verbatim — the {@link filterByConsensus}
 * call, the rate/drop log, and the dry-run-vs-insert branch. It is one deep call
 * here, so a change to how survivors are gated and inserted lands once.
 *
 * The part UPSTREAM of this — constructing boards and assembling candidates —
 * deliberately stays per-generator: the constructors and their dedup rules (single
 * vs batch vs look-alike) genuinely differ, so folding them in too would make a
 * shallow, over-parameterised driver. This module is only the identical tail.
 */

import { filterByConsensus, type ConsensusJudge, type ConsensusResult } from './consensus.js';
import type { BankKey } from './dedup.js';
import type { DataAccess, NewPuzzle, Puzzle } from '@trainer/data';

/** The db surface the insert tail needs (a service-role client, in the generator). */
export type InsertDb = Pick<DataAccess, 'insertPuzzles'>;

export interface InsertOptions {
  db: InsertDb;
  /** When true, report what would be inserted and write nothing. */
  dryRun: boolean;
  /** Plural noun for the logs, e.g. `"spin puzzles"`. */
  label: string;
  /** Optional parenthetical tail for each inserted (stored) row (e.g. the maneuver tags). */
  describe?: (puzzle: Puzzle) => string;
  /** Log sink (defaults to `console.log`), injectable for tests. */
  log?: (...args: unknown[]) => void;
}

/**
 * Insert `kept` into the bank — or, under `--dry-run`, report them and write
 * nothing — with the standard generator log. Returns the stored puzzles (empty for
 * a dry-run or an empty input).
 */
export async function insertOrDryRun(
  kept: NewPuzzle[],
  opts: InsertOptions,
): Promise<Puzzle[]> {
  const log = opts.log ?? console.log;
  if (opts.dryRun) {
    log(`\n--dry-run: would insert ${kept.length} ${opts.label}:`);
    for (const p of kept) log(`  ${p.piece1}+${p.piece2} [${(p.tags ?? []).join(',')}]`);
    return [];
  }
  if (!kept.length) {
    log('\nnothing to insert');
    return [];
  }
  const stored = await opts.db.insertPuzzles(kept);
  log(`\ninserted ${stored.length} ${opts.label}:`);
  for (const p of stored) {
    const tail = opts.describe ? ` (${opts.describe(p)})` : '';
    log(`  #${p.number} ${p.piece1}+${p.piece2}${tail}`);
  }
  return stored;
}

export interface ConsensusInsertOptions extends InsertOptions {
  judge: ConsensusJudge;
  /** Active-bank dedup keys the consensus pass excludes against. */
  existingKeys: BankKey[];
  /** Near-duplicate Hamming threshold (`config.dedupMaxHamming`). */
  maxHamming: number;
}

/**
 * The full strict-consensus tail: a BetaTetris 7/7 consensus pass over `survivors`
 * (logging the keep rate + drop reasons), then {@link insertOrDryRun} of the kept.
 * Returns the consensus result and the stored puzzles.
 */
export async function finishWithConsensus(
  survivors: NewPuzzle[],
  opts: ConsensusInsertOptions,
): Promise<{ consensus: ConsensusResult<NewPuzzle>; stored: Puzzle[] }> {
  const log = opts.log ?? console.log;
  const consensus = await filterByConsensus(survivors, opts.judge, {
    existing: opts.existingKeys,
    maxHamming: opts.maxHamming,
  });
  log(
    `\nBetaTetris consensus: kept ${consensus.kept.length}/${survivors.length} (rate ${(
      consensus.keepRate * 100
    ).toFixed(0)}%, bt-errors ${consensus.btErrors})`,
  );
  const dropReasons: Record<string, number> = {};
  for (const d of consensus.dropped) dropReasons[d.reason] = (dropReasons[d.reason] ?? 0) + 1;
  if (consensus.dropped.length) log('  dropped:', dropReasons);
  const stored = await insertOrDryRun(consensus.kept, opts);
  return { consensus, stored };
}
