import type { CourseId, IngestStatus, Upload } from '@cram/shared';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiFailure } from '../api/api-result';

/** How often a course with an upload still in flight is re-read. */
export const POLL_INTERVAL_MS = 1000;

export type IngestState =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly ingest: Omit<IngestStatus, 'courseId'> }
  | { readonly status: 'failed'; readonly failure: ApiFailure };

const inFlight = (uploads: readonly Upload[]): boolean =>
  uploads.some(({ progress }) => progress.state === 'queued' || progress.state === 'ingesting');

/** A course nobody has uploaded to is `no-such-course`, which on this screen is an empty list. */
const stateOf = (result: Awaited<ReturnType<ApiClient['ingestStatus']>>): IngestState => {
  if (result.status === 'ok') return { status: 'ready', ingest: result.value };
  if (result.status === 'refused' && result.refusal.status === 'no-such-course')
    return { status: 'ready', ingest: { stored: { state: 'read', lectures: [] }, uploads: [] } };
  return { status: 'failed', failure: result };
};

/** Re-reads while any upload is queued or ingesting; `revision` restarts the read after an upload. */
export const useIngestStatus = (
  api: ApiClient,
  courseId: CourseId,
  revision: number,
): IngestState => {
  const [state, setState] = useState<IngestState>({ status: 'pending' });
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      const next = stateOf(await api.ingestStatus(courseId));
      if (!current) return;
      setState(next);
      if (next.status === 'ready' && inFlight(next.ingest.uploads))
        timer = setTimeout(() => void read(), POLL_INTERVAL_MS);
    };
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, courseId, revision]);
  return state;
};
