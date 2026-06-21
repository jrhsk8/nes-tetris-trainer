import { describe, it, expect } from 'vitest';
import { emptyBoard, emptyColorGrid, type Grid } from '@trainer/core';
import type { NewPuzzle, Puzzle, Submission } from '@trainer/data';
import { StackRabbitClient, DEFAULT_BASE_URL } from './engine/client.js';
import { renderScreenshot } from './ocr/screenshot.js';
import { decodePng, encodePng } from './ocr/png.js';
import { processSubmissions, type SubmissionDb } from './submissions.js';

// Deep submission test (#45 acceptance): a KNOWN screenshot is OCR'd, solved
// against the live engine, and banked as a real puzzle; a deliberately bad image
// is rejected with a reason. Skipped cleanly when no engine is reachable.
const baseUrl = process.env.STACKRABBIT_URL ?? DEFAULT_BASE_URL;
const engineUp = await new StackRabbitClient({ baseUrl }).ping();

/** A clean, solvable mid-game board: a flat partial ledge across the bottom. */
function solvableBoard(): Grid {
  const board = emptyBoard();
  for (let c = 0; c <= 5; c++) {
    board[19][c] = 1;
    board[18][c] = 1;
  }
  return board;
}

function fakeDb(images: Record<string, Uint8Array>, pending: Submission[]) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserted: NewPuzzle[] = [];
  const db: SubmissionDb = {
    async listPendingSubmissions() {
      return pending;
    },
    async downloadSubmissionImage(path) {
      return images[path];
    },
    async updateSubmission(id, patch) {
      updates.push({ id, patch: patch as Record<string, unknown> });
    },
    async insertPuzzle(puzzle) {
      inserted.push(puzzle);
      return { ...(puzzle as NewPuzzle), id: 'puz-e2e', glicko: { rating: 1500, deviation: 350, volatility: 0.06 } } as Puzzle;
    },
  };
  return { db, updates, inserted };
}

function sub(id: string, path: string): Submission {
  return {
    id,
    imagePath: path,
    submitter: 'u',
    status: 'pending',
    reason: null,
    parsed: null,
    createdAt: '2026-06-21T00:00:00Z',
  };
}

describe.skipIf(!engineUp)('processSubmissions (deep, live engine)', () => {
  it('OCRs a known screenshot, solves it on the live engine, and banks it', async () => {
    const png = encodePng(
      renderScreenshot({
        board: solvableBoard(),
        colors: emptyColorGrid(),
        currentPiece: 'L',
        nextPiece: 'J',
        level: 18,
      }),
    );
    const { db, updates, inserted } = fakeDb({ 'u/known.png': png }, [sub('s1', 'u/known.png')]);
    const engine = new StackRabbitClient({ baseUrl });

    const result = await processSubmissions({ db, engine });

    expect(result.banked).toBe(1);
    expect(inserted).toHaveLength(1);
    // The banked puzzle carries the OCR'd pieces and a real combo table.
    expect(inserted[0].piece1).toBe('L');
    expect(inserted[0].piece2).toBe('J');
    expect(inserted[0].combos!.entries.length).toBeGreaterThan(0);
    expect(inserted[0].combos!.entries[0].score).toBe(100);
    expect(updates.find((u) => u.id === 's1')!.patch.status).toBe('banked');
  }, 120_000);

  it('rejects a deliberately bad image with a reason, banking nothing', async () => {
    const layoutPng = encodePng(
      renderScreenshot({
        board: emptyBoard(),
        colors: emptyColorGrid(),
        currentPiece: 'T',
        nextPiece: 'I',
        level: 5,
      }),
    );
    // Same dimensions, but mid-grey garbage everywhere → off-palette → rejected.
    const decoded = decodePng(layoutPng);
    const grey = encodePng({
      width: decoded.width,
      height: decoded.height,
      data: new Uint8Array(decoded.data.length).fill(128),
    });
    const { db, updates, inserted } = fakeDb({ 'u/bad.png': grey }, [sub('s2', 'u/bad.png')]);
    const engine = new StackRabbitClient({ baseUrl });

    const result = await processSubmissions({ db, engine });

    expect(result.banked).toBe(0);
    expect(result.rejected).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(updates.find((u) => u.id === 's2')!.patch.status).toBe('rejected');
    expect(updates.find((u) => u.id === 's2')!.patch.reason).toMatch(/^ocr:/);
  }, 120_000);
});
