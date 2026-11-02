import type { CourseId, CourseRepair, IngestStatus, SummaryRemake } from '@cram/shared';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiFailure } from '../api/api-result';

/** How often a course is re-read. */
export const POLL_INTERVAL_MS = 1000;

export type IngestState =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly ingest: Omit<IngestStatus, 'courseId'> }
  | { readonly status: 'failed'; readonly failure: ApiFailure };

export const repairing = ({ state }: CourseRepair): boolean =>
  state === 'queued' || state === 'running';

export const remaking = ({ state }: SummaryRemake['progress']): boolean =>
  state === 'queued' || state === 'running';

const UPLOAD_IN_FLIGHT: ReadonlySet<string> = new Set(['queued', 'ingesting', 'summarising']);

const inFlight = ({ repair, uploads, remakes }: Omit<IngestStatus, 'courseId'>): boolean =>
  repairing(repair) ||
  uploads.some(({ progress }) => UPLOAD_IN_FLIGHT.has(progress.state)) ||
  remakes.some(({ progress }) => remaking(progress));

/** A course nobody has uploaded to is `no-such-course`, which on this screen is an empty list. */
const stateOf = (result: Awaited<ReturnType<ApiClient['ingestStatus']>>): IngestState => {
  if (result.status === 'ok') return { status: 'ready', ingest: result.value };
  if (result.status === 'refused' && result.refusal.status === 'no-such-course')
    return {
      status: 'ready',
      ingest: {
        stored: { state: 'read', lectures: [], report: { state: 'none' } },
        repair: { state: 'none' },
        uploads: [],
        remakes: [],
      },
    };
  return { status: 'failed', failure: result };
};

/** Re-reads while the course's repair or any upload is queued or under way; `revision` restarts the read after an upload. */
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
      if (next.status === 'ready' && inFlight(next.ingest))
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
