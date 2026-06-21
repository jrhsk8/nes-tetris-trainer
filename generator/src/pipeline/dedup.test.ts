import { describe, it, expect } from 'vitest';
import { emptyBoard } from '@trainer/core';
import { boardHamming, isNearDuplicate, type BankKey } from './dedup.js';

describe('boardHamming (#40)', () => {
  it('counts differing cells', () => {
    const a = emptyBoard();
    const b = emptyBoard();
    expect(boardHamming(a, b)).toBe(0);
    b[19][0] = 1;
    b[19][1] = 1;
    expect(boardHamming(a, b)).toBe(2);
  });
});

describe('isNearDuplicate (#40)', () => {
  const board = () => emptyBoard();

  it('rejects a same-pieces board within the Hamming threshold', () => {
    const nearly = board();
    nearly[19][0] = 1; // one differing cell
    const key: BankKey = { piece1: 'O', piece2: 'T', board: nearly };
    const existing: BankKey[] = [{ piece1: 'O', piece2: 'T', board: board() }];
    expect(isNearDuplicate(key, existing, 4)).toBe(true);
  });

  it('does not reject when the piece pair differs', () => {
    const key: BankKey = { piece1: 'I', piece2: 'T', board: board() };
    const existing: BankKey[] = [{ piece1: 'O', piece2: 'T', board: board() }];
    expect(isNearDuplicate(key, existing, 4)).toBe(false);
  });

  it('does not reject when the board is farther than the threshold', () => {
    const far = board();
    for (let c = 0; c < 6; c++) far[19][c] = 1; // 6 differing cells > 4
    const key: BankKey = { piece1: 'O', piece2: 'T', board: far };
    const existing: BankKey[] = [{ piece1: 'O', piece2: 'T', board: board() }];
    expect(isNearDuplicate(key, existing, 4)).toBe(false);
  });
});
