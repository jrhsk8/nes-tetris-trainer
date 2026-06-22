import { describe, it, expect } from 'vitest';
import { letterGrade, formatScore, isWin } from './grade.js';

describe('letterGrade (#60 12-band)', () => {
  it('maps the half-open bands, A+ coinciding with the 97 win line', () => {
    expect(letterGrade(100)).toBe('A+');
    expect(letterGrade(97)).toBe('A+');
    expect(letterGrade(96.9)).toBe('A'); // just below the A+ band
    expect(letterGrade(93)).toBe('A');
    expect(letterGrade(92.9)).toBe('A-');
    expect(letterGrade(90)).toBe('A-');
    expect(letterGrade(87)).toBe('B+');
    expect(letterGrade(83)).toBe('B');
    expect(letterGrade(80)).toBe('B-');
    expect(letterGrade(77)).toBe('C+');
    expect(letterGrade(73)).toBe('C');
    expect(letterGrade(70)).toBe('C-');
    expect(letterGrade(60)).toBe('D');
    expect(letterGrade(59.9)).toBe('F');
    expect(letterGrade(0)).toBe('F');
  });

  it('grades an unranked (null) score F', () => {
    expect(letterGrade(null)).toBe('F');
  });
});

describe('isWin', () => {
  it('is true only at or above the A+ line (97)', () => {
    expect(isWin(97)).toBe(true);
    expect(isWin(100)).toBe(true);
    expect(isWin(96.9)).toBe(false);
    expect(isWin(null)).toBe(false);
  });
});

describe('formatScore (#60 letter + one decimal)', () => {
  it('shows the letter then the score to one decimal', () => {
    expect(formatScore(97.6)).toBe('A+ 97.6');
    expect(formatScore(100)).toBe('A+ 100.0');
    expect(formatScore(80)).toBe('B- 80.0');
    expect(formatScore(75.25)).toBe('C 75.3'); // rounds to one decimal
  });
});
