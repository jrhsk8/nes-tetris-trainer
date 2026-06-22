import { describe, it, expect, vi } from 'vitest';
import { boardMetrics, emptyBoard, emptyColorGrid, encodeBoard, type Line } from '@trainer/core';
import type { NewPuzzle, Puzzle, Submission } from '@trainer/data';
import type { AssemblyResult } from './pipeline/generate.js';
import { renderScreenshot } from './ocr/screenshot.js';
import { encodePng } from './ocr/png.js';
import { processSubmissions, type SubmissionDb } from './submissions.js';

/** A fake submission DB recording status updates and banked puzzles. */
function fakeDb(images: Record<string, Uint8Array>, pending: Submission[]) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserted: NewPuzzle[] = [];
  const db: SubmissionDb = {
    async listPendingSubmissions() {
      return pending;
    },
    async downloadSubmissionImage(path) {
      const bytes = images[path];
      if (!bytes) throw new Error(`no such object: ${path}`);
      return bytes;
    },
    async updateSubmission(id, patch) {
      updates.push({ id, patch: patch as Record<string, unknown> });
    },
    async insertPuzzle(puzzle) {
      inserted.push(puzzle);
      return { ...(puzzle as NewPuzzle), id: `puz-${inserted.length}`, glicko: { rating: 1500, deviation: 350, volatility: 0.06 } } as Puzzle;
    },
  };
  return { db, updates, inserted };
}

function submission(id: string, path: string): Submission {
  return {
    id,
    imagePath: path,
    submitter: 'user-1',
    status: 'pending',
    reason: null,
    parsed: null,
    createdAt: '2026-06-21T00:00:00Z',
  };
}

/** A known screenshot of a T-then-I position. */
function knownScreenshotPng(): Uint8Array {
  const board = emptyBoard();
  const colors = emptyColorGrid();
  for (const c of [3, 4, 5]) {
    board[19][c] = 1;
    colors[19][c] = 2;
  }
  return encodePng(renderScreenshot({ board, colors, currentPiece: 'T', nextPiece: 'I', level: 18 }));
}

describe('processSubmissions (#45)', () => {
  it('OCRs a known screenshot, solves it, and banks the puzzle', async () => {
    const images = { 'user-1/a.png': knownScreenshotPng() };
    const { db, updates, inserted } = fakeDb(images, [submission('s1', 'user-1/a.png')]);

    // Stub the solver: assert it received the OCR'd board + pieces, return a puzzle.
    const solve = vi.fn(async (candidate): Promise<AssemblyResult> => {
      expect(candidate.currentPiece).toBe('T');
      expect(candidate.nextPiece).toBe('I');
      expect(candidate.board[19][3]).toBe(1);
      expect(candidate.level).toBe(18);
      const line: Line = [
        { rotation: 0, col: 0 },
        { rotation: 0, col: 6 },
      ];
      return {
        ok: true,
        lane: 'strict',
        puzzle: {
          board: encodeBoard(candidate.board),
          piece1: candidate.currentPiece,
          piece2: candidate.nextPiece,
          optimalLine: line,
          optimalMetrics: boardMetrics(candidate.board),
          combos: { entries: [{ rot1: 0, col1: 0, rot2: 0, col2: 6, score: 100 }], total: 1 },
        },
      };
    });

    const result = await processSubmissions({ db, solve });

    expect(result).toMatchObject({ processed: 1, banked: 1, rejected: 0 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].piece1).toBe('T');
    // The row was flipped to banked with the new puzzle id recorded.
    const banked = updates.find((u) => u.id === 's1');
    expect(banked!.patch.status).toBe('banked');
    expect((banked!.patch.parsed as { puzzleId: string }).puzzleId).toBe('puz-1');
  });

  it('rejects a deliberately bad image with a reason and banks nothing', async () => {
    // A mid-grey raster at the right dimensions: off-palette everywhere, so the
    // board fails the confidence floor and OCR rejects it before solving.
    const layout = renderScreenshot({
      board: emptyBoard(),
      colors: emptyColorGrid(),
      currentPiece: 'T',
      nextPiece: 'I',
      level: 5,
    });
    const grey = encodePng({
      width: layout.width,
      height: layout.height,
      data: new Uint8Array(layout.data.length).fill(128),
    });

    const images = { 'user-1/bad.png': grey };
    const { db, updates, inserted } = fakeDb(images, [submission('s2', 'user-1/bad.png')]);
    const solve = vi.fn();

    const result = await processSubmissions({ db, solve });

    expect(result).toMatchObject({ processed: 1, banked: 0, rejected: 1 });
    expect(solve).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
    const rejected = updates.find((u) => u.id === 's2');
    expect(rejected!.patch.status).toBe('rejected');
    expect(rejected!.patch.reason).toMatch(/^ocr:/);
  });

  it('rejects (does not throw) when the solver rejects the position', async () => {
    const images = { 'user-1/a.png': knownScreenshotPng() };
    const { db, updates, inserted } = fakeDb(images, [submission('s3', 'user-1/a.png')]);
    const solve = vi.fn(async (): Promise<AssemblyResult> => ({ ok: false, reason: 'no-rateable-combos' }));

    const result = await processSubmissions({ db, solve });

    expect(result).toMatchObject({ banked: 0, rejected: 1 });
    expect(inserted).toHaveLength(0);
    const rejected = updates.find((u) => u.id === 's3');
    expect(rejected!.patch.status).toBe('rejected');
    expect(rejected!.patch.reason).toBe('solve:no-rateable-combos');
  });

  it('rejects a non-image (SVG/polyglot) by magic bytes before any decode (#67)', async () => {
    // An SVG/text payload — no PNG/JPEG signature. The processor must reject it
    // up front, never feeding it to the image decoder.
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    const decode = vi.fn(); // must NOT be called
    const { db, updates, inserted } = fakeDb({ 'user-1/x': svg }, [submission('s4', 'user-1/x')]);

    const result = await processSubmissions({ db, decode, solve: vi.fn() });

    expect(result).toMatchObject({ banked: 0, rejected: 1 });
    expect(inserted).toHaveLength(0);
    expect(decode).not.toHaveBeenCalled();
    expect(updates.find((u) => u.id === 's4')!.patch.reason).toBe('not-an-image');
  });

  it('rejects a decompression-bomb PNG (huge declared dimensions) (#67)', async () => {
    // A valid PNG signature + IHDR declaring 99999×99999 — a tiny file that would
    // decode to a multi-GB raster. The dimension guard in decodePng refuses it.
    const bomb = new Uint8Array(24);
    bomb.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
    bomb.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    new DataView(bomb.buffer).setUint32(16, 99999); // width
    new DataView(bomb.buffer).setUint32(20, 99999); // height
    const { db, updates, inserted } = fakeDb({ 'user-1/bomb.png': bomb }, [
      submission('s5', 'user-1/bomb.png'),
    ]);

    const result = await processSubmissions({ db, solve: vi.fn() });

    expect(result).toMatchObject({ banked: 0, rejected: 1 });
    expect(inserted).toHaveLength(0);
    expect(updates.find((u) => u.id === 's5')!.patch.reason).toBe('image-decode-failed');
  });
});
