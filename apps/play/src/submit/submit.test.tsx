// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NewSubmission, Submission } from '@trainer/data';
import { SubmitScreenshot, type SubmitDb } from './SubmitScreenshot.js';

afterEach(() => cleanup());

/** A File whose bytes are readable in jsdom (which lacks File#arrayBuffer). */
function pngFile(name: string, bytes: number[]): File {
  const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new Uint8Array(bytes).buffer,
  });
  return file;
}

function fakeDb() {
  const uploads: Array<{ path: string; bytes: Uint8Array; contentType?: string }> = [];
  const enqueued: NewSubmission[] = [];
  const db: SubmitDb = {
    async uploadSubmissionImage(path, bytes, contentType) {
      uploads.push({ path, bytes, contentType });
    },
    async insertSubmission(submission): Promise<Submission> {
      enqueued.push(submission);
      return {
        id: 'sub-1',
        imagePath: submission.imagePath,
        submitter: submission.submitter,
        status: 'pending',
        reason: null,
        parsed: null,
        createdAt: '2026-06-21T00:00:00Z',
      };
    },
  };
  return { db, uploads, enqueued };
}

describe('SubmitScreenshot (#45)', () => {
  it('uploads the chosen image and enqueues a pending submission', async () => {
    const user = userEvent.setup();
    const { db, uploads, enqueued } = fakeDb();
    render(<SubmitScreenshot db={db} userId="user-1" />);

    const file = pngFile('board.png', [1, 2, 3, 4]);
    await user.upload(screen.getByLabelText('board screenshot'), file);

    await waitFor(() => expect(screen.getByTestId('submit-status')).toHaveTextContent('Queued'));

    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^user-1\//);
    expect(uploads[0].bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(enqueued).toHaveLength(1);
    // The enqueued row points at the uploaded object and the submitter.
    expect(enqueued[0].imagePath).toBe(uploads[0].path);
    expect(enqueued[0].submitter).toBe('user-1');
  });

  it('surfaces an upload failure instead of silently enqueuing', async () => {
    const user = userEvent.setup();
    const { db, enqueued } = fakeDb();
    db.uploadSubmissionImage = vi.fn(async () => {
      throw new Error('storage offline');
    });
    render(<SubmitScreenshot db={db} userId="user-1" />);

    const file = pngFile('board.png', [1]);
    await user.upload(screen.getByLabelText('board screenshot'), file);

    await waitFor(() => expect(screen.getByTestId('submit-error')).toHaveTextContent('storage offline'));
    expect(enqueued).toHaveLength(0);
  });
});
