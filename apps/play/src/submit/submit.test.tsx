// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NewSubmission, Submission } from '@trainer/data';
import { SubmitScreenshot, type SubmitDb } from './SubmitScreenshot.js';

afterEach(() => cleanup());

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A File whose bytes are readable in jsdom (which lacks File#arrayBuffer). */
function imageFile(name: string, bytes: number[], type = 'image/png'): File {
  const file = new File([new Uint8Array(bytes)], name, { type });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new Uint8Array(bytes).buffer,
  });
  return file;
}

function fakeDb() {
  // The data-access layer server-generates the path now (#67); the fake mirrors
  // that by deriving a per-user path from the userId + a stub uuid.
  const uploads: Array<{ userId: string; bytes: Uint8Array }> = [];
  const enqueued: NewSubmission[] = [];
  const db: SubmitDb = {
    async uploadSubmissionImage(userId, bytes) {
      uploads.push({ userId, bytes });
      return `${userId}/generated.png`;
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

describe('SubmitScreenshot (#45/#67)', () => {
  it('uploads the chosen image (server-generated path) and enqueues a pending submission', async () => {
    const user = userEvent.setup();
    const { db, uploads, enqueued } = fakeDb();
    render(<SubmitScreenshot db={db} userId="user-1" />);

    const file = imageFile('board.png', [...PNG_MAGIC, 1, 2, 3, 4]);
    await user.upload(screen.getByLabelText('board screenshot'), file);

    await waitFor(() => expect(screen.getByTestId('submit-status')).toHaveTextContent('Queued'));

    expect(uploads).toHaveLength(1);
    // The client passes only the userId + bytes — it no longer chooses the path.
    expect(uploads[0].userId).toBe('user-1');
    expect(enqueued).toHaveLength(1);
    // The enqueued row points at the SERVER-generated object path.
    expect(enqueued[0].imagePath).toBe('user-1/generated.png');
    expect(enqueued[0].submitter).toBe('user-1');
  });

  it('rejects a mislabeled non-image by magic bytes, without uploading (#67)', async () => {
    const user = userEvent.setup();
    const { db, uploads, enqueued } = fakeDb();
    render(<SubmitScreenshot db={db} userId="user-1" />);

    // A file CLAIMING image/png (so it passes the accept filter) but whose bytes
    // are an SVG/polyglot — no PNG/JPEG magic number. The byte sniff rejects it.
    const file = imageFile('evil.png', [0x3c, 0x73, 0x76, 0x67], 'image/png');
    await user.upload(screen.getByLabelText('board screenshot'), file);

    await waitFor(() => expect(screen.getByTestId('submit-error')).toHaveTextContent('PNG or JPEG'));
    expect(uploads).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('blocks an anonymous session from submitting (#67)', () => {
    const { db } = fakeDb();
    render(<SubmitScreenshot db={db} userId="anon-1" isAnonymous />);
    expect(screen.getByTestId('submit-signin-required')).toBeInTheDocument();
    expect(screen.queryByLabelText('board screenshot')).toBeNull();
  });

  it('surfaces an upload failure instead of silently enqueuing', async () => {
    const user = userEvent.setup();
    const { db, enqueued } = fakeDb();
    db.uploadSubmissionImage = vi.fn(async () => {
      throw new Error('storage offline');
    });
    render(<SubmitScreenshot db={db} userId="user-1" />);

    const file = imageFile('board.png', [...PNG_MAGIC, 1]);
    await user.upload(screen.getByLabelText('board screenshot'), file);

    await waitFor(() => expect(screen.getByTestId('submit-error')).toHaveTextContent('storage offline'));
    expect(enqueued).toHaveLength(0);
  });
});
