/**
 * Letter grades for combo scores (#60, grill #5).
 *
 * Every place a /100 score showed (the verdict and every combo-list row) now
 * displays a standard US 12-band letter plus the raw score to one decimal, e.g.
 * `A+ 97.6`. The bands are half-open intervals on the real score, with the A+
 * band coinciding with the win line (`CORRECT_SCORE_THRESHOLD = 97`): only an A+
 * answer scores a rating gain. An unranked combo (too low to rank) has no
 * numeric score and grades `F`.
 */

/** One letter band: its lower bound (inclusive) on the 0–100 score. */
interface Band {
  letter: string;
  min: number;
}

// Half-open bands, highest first: A+ = [97,100], A = [93,97), … F = [0,60).
const BANDS: readonly Band[] = [
  { letter: 'A+', min: 97 },
  { letter: 'A', min: 93 },
  { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 },
  { letter: 'B', min: 83 },
  { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 },
  { letter: 'C', min: 73 },
  { letter: 'C-', min: 70 },
  { letter: 'D', min: 60 },
  { letter: 'F', min: 0 },
];

/** The 12-band letter grade for a 0–100 `score` (`null`/unranked → `F`). */
export function letterGrade(score: number | null): string {
  if (score === null) return 'F';
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]).letter;
}

/** True iff the score earns an A+ — the win line (rating gain). */
export function isWin(score: number | null): boolean {
  return score !== null && score >= BANDS[0].min;
}

/** A combo score as `letter + one-decimal number`, e.g. `A+ 97.6`. */
export function formatScore(score: number): string {
  return `${letterGrade(score)} ${score.toFixed(1)}`;
}
