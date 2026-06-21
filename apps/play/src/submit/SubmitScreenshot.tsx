/**
 * Submit-a-screenshot view (#45, v2 overhaul issue I) — the client half of the
 * board-submission pipeline. The player picks a board screenshot; it is uploaded
 * to Storage and enqueued as a `pending` submission. The OFFLINE pipeline later
 * OCRs, solves, and banks or rejects it (the engine never ships to the browser).
 *
 * This is purely an upload + enqueue affordance: no OCR or grading happens here.
 */

import { useCallback, useState } from 'react';
import type { DataAccess } from '@trainer/data';

/** The persistence this view needs: upload the image, then enqueue the row. */
export type SubmitDb = Pick<DataAccess, 'uploadSubmissionImage' | 'insertSubmission'>;

export interface SubmitScreenshotProps {
  db: SubmitDb;
  /** The submitter's id (their anonymous/auth session). */
  userId: string;
}

type Status = 'idle' | 'uploading' | 'queued' | 'error';

export function SubmitScreenshot({ db, userId }: SubmitScreenshotProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (file: File) => {
      setStatus('uploading');
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const path = `${userId}/${crypto.randomUUID()}.png`;
        await db.uploadSubmissionImage(path, bytes, file.type || 'image/png');
        await db.insertSubmission({ imagePath: path, submitter: userId });
        setStatus('queued');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, userId],
  );

  return (
    <section className="submit" data-testid="view-submit">
      <h2>Submit a board</h2>
      <p>
        Upload a screenshot of an NES board. We’ll OCR it offline, find its best two-piece combo,
        and add it to the bank.
      </p>
      <input
        type="file"
        accept="image/png,image/*"
        aria-label="board screenshot"
        disabled={status === 'uploading'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void submit(file);
        }}
      />
      {status === 'uploading' && (
        <p data-testid="submit-status" role="status">
          Uploading…
        </p>
      )}
      {status === 'queued' && (
        <p data-testid="submit-status" role="status">
          Queued for review. Thanks!
        </p>
      )}
      {status === 'error' && (
        <p data-testid="submit-error" role="alert">
          Upload failed: {error}
        </p>
      )}
    </section>
  );
}
