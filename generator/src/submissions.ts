/**
 * Offline submission processing (#45, v2 overhaul issue I) — turn queued
 * screenshot submissions into banked puzzles, or reject them with a reason.
 *
 * For each `pending` submission it downloads the screenshot, OCRs it into a
 * position ({@link parseScreenshot}), feeds that to the SAME generation pipeline
 * self-play uses ({@link assemblePuzzle} — combo sweep, gates, difficulty), and
 * banks the survivor or records the rejection. The engine runs only here,
 * offline; nothing about this ships to the play app. A misread is rejected, not
 * banked: OCR low-confidence and unreadable pieces/level reject up front.
 */

import { encodeBoard } from '@trainer/core';
import type { DataAccess } from '@trainer/data';
import type { Candidate } from './selfplay/board-source.js';
import { assemblePuzzle, type AssemblyResult, type GeneratorEngine } from './pipeline/generate.js';
import { decodePng } from './ocr/png.js';
import { parseScreenshot, type Raster } from './ocr/screenshot.js';

/** The data-access slice the processor needs. */
export type SubmissionDb = Pick<
  DataAccess,
  'listPendingSubmissions' | 'downloadSubmissionImage' | 'updateSubmission' | 'insertPuzzle'
>;

export interface ProcessDeps {
  db: SubmissionDb;
  /** Engine for the default solver; not needed when `solve` is injected. */
  engine?: GeneratorEngine;
  /** Solve a candidate into a puzzle (defaults to {@link assemblePuzzle}). */
  solve?: (candidate: Candidate) => Promise<AssemblyResult>;
  /** Decode image bytes to a raster (defaults to PNG decode). */
  decode?: (bytes: Uint8Array) => Raster;
  onProgress?: (message: string) => void;
}

/** Per-submission outcome. */
export interface SubmissionOutcome {
  id: string;
  status: 'banked' | 'rejected';
  reason?: string;
  puzzleId?: string;
}

export interface ProcessResult {
  processed: number;
  banked: number;
  rejected: number;
  outcomes: SubmissionOutcome[];
}

/**
 * Process every pending submission once. Returns a summary; each submission's
 * row is updated to `banked` (with the new puzzle id in `parsed`) or `rejected`
 * (with a reason). Never throws on a single bad submission — it is rejected and
 * processing continues.
 */
export async function processSubmissions(deps: ProcessDeps): Promise<ProcessResult> {
  const decode = deps.decode ?? decodePng;
  const solve =
    deps.solve ??
    ((candidate: Candidate) => {
      if (!deps.engine) throw new Error('processSubmissions needs an engine or a solve function');
      return assemblePuzzle(deps.engine, candidate);
    });
  const onProgress = deps.onProgress ?? (() => {});

  const pending = await deps.db.listPendingSubmissions();
  const outcomes: SubmissionOutcome[] = [];

  for (const submission of pending) {
    const reject = async (reason: string, parsedExtra: Record<string, unknown> = {}) => {
      await deps.db.updateSubmission(submission.id, {
        status: 'rejected',
        reason,
        parsed: parsedExtra,
      });
      outcomes.push({ id: submission.id, status: 'rejected', reason });
      onProgress(`rejected ${submission.id}: ${reason}`);
    };

    let raster: Raster;
    try {
      raster = decode(await deps.db.downloadSubmissionImage(submission.imagePath));
    } catch (err) {
      await reject('image-download-or-decode-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const ocr = parseScreenshot(raster);
    if (!ocr.ok) {
      await reject(`ocr:${ocr.reason}`, { confidence: ocr.confidence });
      continue;
    }

    const { board, colors, currentPiece, nextPiece, level, confidence } = ocr.parsed;
    const candidate: Candidate = { board, colors, currentPiece, nextPiece, level, lines: 0 };

    let assembly: AssemblyResult;
    try {
      assembly = await solve(candidate);
    } catch (err) {
      await reject('solve-error', { error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!assembly.ok) {
      await reject(`solve:${assembly.reason}`, {
        board: encodeBoard(board),
        currentPiece,
        nextPiece,
        level,
        confidence,
      });
      continue;
    }

    const puzzle = await deps.db.insertPuzzle(assembly.puzzle);
    await deps.db.updateSubmission(submission.id, {
      status: 'banked',
      reason: null,
      parsed: { board: encodeBoard(board), currentPiece, nextPiece, level, confidence, puzzleId: puzzle.id },
    });
    outcomes.push({ id: submission.id, status: 'banked', puzzleId: puzzle.id });
    onProgress(`banked ${submission.id} → puzzle ${puzzle.id}`);
  }

  const banked = outcomes.filter((o) => o.status === 'banked').length;
  return { processed: pending.length, banked, rejected: outcomes.length - banked, outcomes };
}
