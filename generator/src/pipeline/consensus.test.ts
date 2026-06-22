import { describe, it, expect } from 'vitest';
import { emptyBoard, encodeBoard, type Line } from '@trainer/core';
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
});

describe('filterByConsensus', () => {
  it('keeps top-1 agreers and drops disagreers, reporting the keep rate', async () => {
    const puzzles = [puzzle('1', LINE_A), puzzle('2', LINE_B), puzzle('3', LINE_A)];
    // Net blesses #1 and #3 (rank 1); #2 is a rank-2 disagree.
    const judge: ConsensusJudge = async (rows) =>
      rows.map<ConsensusVerdict>((r) => {
        const keep = r.number !== 2;
        return { number: r.number, id: r.id, keep, reason: keep ? null : 'disagree', rank: keep ? 1 : 2 };
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
      { number: rows[0].number, id: rows[0].id, keep: true, reason: null, rank: 1 },
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
      return rows.map((r) => ({ number: r.number, id: r.id, keep: true, reason: null, rank: 1 }));
    };
    await filterByConsensus(puzzles, judge);
    expect(seen).toBe(consensusKeys(puzzles[0]).p1Key);
  });
});
