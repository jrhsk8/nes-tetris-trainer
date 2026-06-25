import { describe, it, expect } from 'vitest';
import {
  applyRestingPlacement,
  boardKey,
  decodeBoard,
  emptyBoard,
  encodeBoard,
  type ComboTable,
  type Line,
} from '@trainer/core';
import {
  consensusKeys,
  filterByConsensus,
  type ConsensusJudge,
  type ConsensusPuzzle,
  type ConsensusVerdict,
} from './consensus.js';

const BOARD = encodeBoard(emptyBoard());

function puzzle(id: string, line: Line): ConsensusPuzzle {
  return { id, number: Number(id.replace(/\D/g, '')) || null, board: BOARD, piece1: 'T', piece2: 'L', optimalLine: line };
}

const LINE_A: Line = [
  { rotation: 0, col: 0 },
  { rotation: 0, col: 3 },
];
const LINE_B: Line = [
  { rotation: 0, col: 4 },
  { rotation: 0, col: 6 },
];

describe('consensus keys', () => {
  it('derives a stable outcome key from board + pieces + optimal line', () => {
    const a = consensusKeys(puzzle('p1', LINE_A));
    const b = consensusKeys(puzzle('p1', LINE_A));
    expect(a).toEqual(b); // deterministic
    expect(a.p1Key).toHaveLength(200);
    expect(a.fullKey).toHaveLength(200);
    // A different first placement lands a different piece-1 outcome.
    expect(consensusKeys(puzzle('p2', LINE_B)).p1Key).not.toBe(a.p1Key);
  });

  it('keys off the combo boardKey for a spin, not a hard-drop of the line', () => {
    // A forced T-spin-double board: O fills cols 0–1, T spins into the slot under
    // the roof at (17,5). The stored optimalLine is {rot,col} only, so hard-dropping
    // the T mis-places it — the real outcome is the combo entry's boardKey.
    const board0 = decodeBoard(
      [...Array<string>(17).fill('0000000000'), '0010011111', '1110001111', '1111011111'].join(''),
    );
    const afterO = applyRestingPlacement(board0, 'O', { rotation: 0, row: 16, col: 0 });
    const spinOutcome = boardKey(applyRestingPlacement(afterO, 'T', { rotation: 2, row: 18, col: 3 }));

    const combos: ComboTable = {
      entries: [{ rot1: 0, col1: 0, rot2: 2, col2: 3, score: 100, boardKey: spinOutcome }],
      total: 1,
    };
    const base = {
      id: 'spin',
      board: encodeBoard(board0),
      piece1: 'O',
      piece2: 'T',
      optimalLine: [{ rotation: 0, col: 0 }, { rotation: 2, col: 3 }] as Line,
    };

    // with the combo table: fullKey is the true spin outcome
    expect(consensusKeys({ ...base, combos }).fullKey).toBe(spinOutcome);
    // without it (legacy fallback): hard-dropping the T lands a DIFFERENT board
    expect(consensusKeys(base).fullKey).not.toBe(spinOutcome);
  });
});

describe('filterByConsensus', () => {
  it('keeps top-1 agreers and drops disagreers, reporting the keep rate', async () => {
    const puzzles = [puzzle('1', LINE_A), puzzle('2', LINE_B), puzzle('3', LINE_A)];
    // Net blesses #1 and #3 (rank 1); #2 is a rank-2 disagree.
    const judge: ConsensusJudge = async (rows) =>
      rows.map<ConsensusVerdict>((r) => {
        const keep = r.number !== 2;
        return { number: r.number, id: r.id, keep, reason: keep ? null : 'disagree', rank: keep ? 1 : 2, p2_agree: keep ? 7 : null, p2_of: keep ? 7 : null };
      });

    const result = await filterByConsensus(puzzles, judge);

    expect(result.kept.map((p) => p.id)).toEqual(['1', '3']);
    expect(result.dropped).toEqual([{ puzzle: puzzles[1], reason: 'disagree' }]);
    expect(result.keepRate).toBeCloseTo(2 / 3);
    expect(result.btErrors).toBe(0);
  });

  it('is fail-closed: a bt-error verdict drops the puzzle and is counted apart from disagree', async () => {
    const puzzles = [puzzle('1', LINE_A), puzzle('2', LINE_B)];
    const judge: ConsensusJudge = async (rows) =>
      rows.map<ConsensusVerdict>((r) => ({
        number: r.number,
        id: r.id,
        keep: false,
        reason: r.number === 1 ? 'bt-error' : 'disagree',
        rank: null,
        p2_agree: null,
        p2_of: null,
      }));

    const result = await filterByConsensus(puzzles, judge);

    expect(result.kept).toHaveLength(0);
    expect(result.btErrors).toBe(1); // only the bt-error, not the genuine disagree
    expect(result.dropped.map((d) => d.reason).sort()).toEqual(['bt-error', 'disagree']);
  });

  it('is fail-closed: a missing verdict (short/crashed judge) drops as bt-error', async () => {
    const puzzles = [puzzle('1', LINE_A), puzzle('2', LINE_B)];
    // Judge only returns a verdict for the first row.
    const judge: ConsensusJudge = async (rows) => [
      { number: rows[0].number, id: rows[0].id, keep: true, reason: null, rank: 1, p2_agree: 7, p2_of: 7 },
    ];

    const result = await filterByConsensus(puzzles, judge);

    expect(result.kept.map((p) => p.id)).toEqual(['1']);
    expect(result.dropped).toEqual([{ puzzle: puzzles[1], reason: 'bt-error' }]);
    expect(result.btErrors).toBe(1);
  });

  it('passes the keyed rows (with p1_key) to the judge', async () => {
    const puzzles = [puzzle('1', LINE_A)];
    let seen: string | undefined;
    const judge: ConsensusJudge = async (rows) => {
      seen = rows[0].p1_key;
      return rows.map((r) => ({ number: r.number, id: r.id, keep: true, reason: null, rank: 1, p2_agree: 7, p2_of: 7 }));
    };
    await filterByConsensus(puzzles, judge);
    expect(seen).toBe(consensusKeys(puzzles[0]).p1Key);
  });
});
