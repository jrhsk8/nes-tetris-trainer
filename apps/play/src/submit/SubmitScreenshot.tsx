/**
 * Submit-a-screenshot view (#45, v2 overhaul issue I) — the client half of the
 * board-submission pipeline. The player picks a board screenshot; it is uploaded
 * to Storage and enqueued as a `pending` submission. The OFFLINE pipeline later
 * OCRs, solves, and banks or rejects it (the engine never ships to the browser).
 *
 * This is purely an upload + enqueue affordance: no OCR or grading happens here.
 */

import { useCallback, useState } from 'react';
import { ALLOWED_IMAGE_MIMES, MAX_UPLOAD_BYTES, sniffImageMime, type DataAccess } from '@trainer/data';

/** The persistence this view needs: upload the image, then enqueue the row. */
export type SubmitDb = Pick<DataAccess, 'uploadSubmissionImage' | 'insertSubmission'>;

export interface SubmitScreenshotProps {
  db: SubmitDb;
  /** The submitter's id (their anonymous/auth session). */
  userId: string;
  /**
   * Whether the session is anonymous (#67). Submitting requires a real
   * (non-anonymous) account, so an anonymous visitor sees a sign-in prompt
   * instead of the upload control.
   */
  isAnonymous?: boolean;
}

type Status = 'idle' | 'uploading' | 'queued' | 'error';

export function SubmitScreenshot({ db, userId, isAnonymous = false }: SubmitScreenshotProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (file: File) => {
      setStatus('uploading');
      setError(null);
      try {
        // Client-side pre-checks (#67) for fast feedback; the data-access layer
        // and Storage RLS re-enforce size/type/path authoritatively.
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error('Image is larger than 5 MB.');
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!sniffImageMime(bytes)) {
          throw new Error('Only PNG or JPEG screenshots are accepted.');
        }
        // The storage path + content-type are server-generated (#67); the client
        // no longer chooses them.
        const path = await db.uploadSubmissionImage(userId, bytes);
        await db.insertSubmission({ imagePath: path, submitter: userId });
        setStatus('queued');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, userId],
  );

  if (isAnonymous) {
    return (
      <section className="submit" data-testid="view-submit">
        <h2>Submit a board</h2>
        <p data-testid="submit-signin-required">
          Sign in with an account to submit a board. Anonymous play can’t submit.
        </p>
      </section>
    );
  }

  return (
    <section className="submit" data-testid="view-submit">
      <h2>Submit a board</h2>
      <p>
        Upload a screenshot of an NES board. We’ll OCR it offline, find its best two-piece combo,
        and add it to the bank.
      </p>
      <input
        type="file"
        accept={ALLOWED_IMAGE_MIMES.join(',')}
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
