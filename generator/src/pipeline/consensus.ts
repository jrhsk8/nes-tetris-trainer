/**
 * BetaTetris normal-net top-1 **consensus filter** (#55) — the standard *final*
 * stage of bank generation (docs/decisions.md, 2026-06-21).
 *
 * Generation stays pure TS/StackRabbit (see {@link generateBank}); this stage
 * runs afterwards and drops any puzzle the BetaTetris **normal** net does not
 * bless: a puzzle is kept iff the net's #1 piece-1 policy move lands the SAME
 * board as our stored optimal's piece-1 placement (compared by the canonical
 * 200-char outcome key, so the check is convention-free). It is a **filter, not
 * a re-rank** — disagreers are dropped, never relabelled with BT's move, so the
 * StackRabbit-derived combo table and graded rewards stay the optimal's.
 *
 * Two guardrails are baked in:
 *  - **Normal net only.** The `perfect` net is off-objective for a general
 *    stacking trainer (trained for maxout/killscreen tetris-only play) and is
 *    dropped from the standard path.
 *  - **Fail-closed.** A puzzle BetaTetris cannot cleanly judge (engine error,
 *    unreachable outcome, odd-parity board, inject mismatch) is rejected, and the
 *    BT-error count is surfaced separately so flakiness never silently inflates
 *    the cull.
 *
 * BetaTetris is offline / generator-only (the StackRabbit guardrail applies
 * equally — never deployed, never called from `apps/play`; GPLv3). The actual
 * net is reached through an injectable {@link ConsensusJudge}, so this stage is
 * unit-tested without PyTorch; the production judge ({@link betaTetrisJudge})
 * shells to `betatetris-spike/consensus.py`.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPlacement, boardKey, decodeBoard, type Line } from '@trainer/core';

/** The minimum a puzzle must expose to be consensus-checked. */
export interface ConsensusPuzzle {
  /** Stable id (DB uuid for live puzzles; any tag for fresh ones). */
  id?: string;
  number?: number | null;
  /** 200-char encoded start board (`encodeBoard`). */
  board: string;
  piece1: string;
  piece2: string;
  /** The stored optimal two-placement line (rank-1 combo). */
  optimalLine: Line;
}

/** Outcome keys after the stored optimal's piece-1 (and both) placements. */
export function consensusKeys(p: ConsensusPuzzle): { p1Key: string; fullKey: string } {
  const board0 = decodeBoard(p.board);
  const afterP1 = applyPlacement(board0, p.piece1 as never, p.optimalLine[0]);
  const afterP2 = applyPlacement(afterP1, p.piece2 as never, p.optimalLine[1]);
  return { p1Key: boardKey(afterP1), fullKey: boardKey(afterP2) };
}

/** One keyed puzzle as handed to the BT judge (the `bank_keys.json` row shape). */
export interface ConsensusKeyRow {
  id: string;
  number: number | null;
  board: string;
  piece1: string;
  piece2: string;
  /** Outcome key after the optimal's piece-1 placement — the move BT must bless. */
  p1_key: string;
  full_key: string;
}

/** Why a puzzle was dropped (or `null` when kept). `bt-error` is machinery failure. */
export type ConsensusReason =
  | 'disagree'
  | 'unreachable'
  | 'odd-parity'
  | 'inject-mismatch'
  | 'bt-error';

/** The BT verdict for one puzzle. */
export interface ConsensusVerdict {
  number: number | null;
  id: string | null;
  keep: boolean;
  reason: ConsensusReason | null;
  /** 1-indexed rank of our optimal in the net's policy, or `null` if unreachable. */
  rank: number | null;
}

/**
 * The BetaTetris surface: judge a batch of keyed puzzles, returning one verdict
 * per row in the SAME order. Injected so the filter is testable without the net.
 */
export type ConsensusJudge = (rows: ConsensusKeyRow[]) => Promise<ConsensusVerdict[]>;

/** Outcome of a consensus pass over a set of puzzles. */
export interface ConsensusResult<T extends ConsensusPuzzle> {
  /** Puzzles the net blessed (top-1 consensus). */
  kept: T[];
  /** Dropped puzzles with the reason each failed. */
  dropped: Array<{ puzzle: T; reason: ConsensusReason }>;
  /** Fraction kept (genuine top-1 consensus rate, BT-errors included in the denominator). */
  keepRate: number;
  /** Drops attributable to machinery failure (logged apart from genuine disagree). */
  btErrors: number;
  /** The raw per-puzzle verdicts, in input order. */
  verdicts: ConsensusVerdict[];
}

/**
 * Partition `puzzles` into kept / dropped by the BetaTetris top-1 consensus
 * verdict (#55). Fail-closed: a missing or malformed verdict is treated as a
 * `bt-error` drop, so a flaky judge can only ever shrink the bank, never keep an
 * unjudged puzzle. The kept set is guaranteed 100% top-1-consensus.
 */
export async function filterByConsensus<T extends ConsensusPuzzle>(
  puzzles: T[],
  judge: ConsensusJudge,
): Promise<ConsensusResult<T>> {
  if (puzzles.length === 0) {
    return { kept: [], dropped: [], keepRate: 1, btErrors: 0, verdicts: [] };
  }
  const rows: ConsensusKeyRow[] = puzzles.map((p, i) => {
    const { p1Key, fullKey } = consensusKeys(p);
    return {
      id: p.id ?? String(i),
      number: p.number ?? null,
      board: p.board,
      piece1: p.piece1,
      piece2: p.piece2,
      p1_key: p1Key,
      full_key: fullKey,
    };
  });

  const verdicts = await judge(rows);

  const kept: T[] = [];
  const dropped: Array<{ puzzle: T; reason: ConsensusReason }> = [];
  let btErrors = 0;
  const out: ConsensusVerdict[] = [];
  for (let i = 0; i < puzzles.length; i++) {
    const v = verdicts[i];
    // Fail-closed: no verdict (judge returned short / crashed) → bt-error drop.
    if (!v) {
      dropped.push({ puzzle: puzzles[i], reason: 'bt-error' });
      btErrors++;
      out.push({ number: rows[i].number, id: rows[i].id, keep: false, reason: 'bt-error', rank: null });
      continue;
    }
    out.push(v);
    if (v.keep) {
      kept.push(puzzles[i]);
    } else {
      const reason = v.reason ?? 'bt-error';
      if (reason === 'bt-error') btErrors++;
      dropped.push({ puzzle: puzzles[i], reason });
    }
  }

  return {
    kept,
    dropped,
    keepRate: kept.length / puzzles.length,
    btErrors,
    verdicts: out,
  };
}

/** Where the production Python adapter lives, relative to the repo root. */
const CONSENSUS_PY = 'betatetris-spike/consensus.py';

/**
 * The production {@link ConsensusJudge}: write the keyed rows to a temp file,
 * run `bt-run python consensus.py` (the normal-net top-1 verdict) over them, and
 * read back the per-puzzle verdicts (matched to input rows by id). Offline /
 * generator-only. Pass `{ cwd }` for the repo root if not the process cwd.
 */
export function betaTetrisJudge(opts: { cwd?: string; runner?: string } = {}): ConsensusJudge {
  const cwd = opts.cwd ?? process.cwd();
  const runner = opts.runner ?? 'bt-run';
  return async (rows: ConsensusKeyRow[]): Promise<ConsensusVerdict[]> => {
    const dir = mkdtempSync(join(tmpdir(), 'bt-consensus-'));
    const inPath = join(dir, 'keys.json');
    const outPath = join(dir, 'verdict.json');
    writeFileSync(inPath, JSON.stringify(rows));

    await new Promise<void>((resolve, reject) => {
      const child = spawn(runner, ['python', CONSENSUS_PY, inPath, outPath], {
        cwd,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`consensus.py exited ${code}`)),
      );
    });

    const raw = JSON.parse(readFileSync(outPath, 'utf8')) as ConsensusVerdict[];
    // Re-key by id so order/length mismatches fail closed (missing → undefined →
    // the filter treats it as a bt-error drop).
    const byId = new Map(raw.map((v) => [v.id, v]));
    return rows.map((r) => byId.get(r.id) as ConsensusVerdict);
  };
}
