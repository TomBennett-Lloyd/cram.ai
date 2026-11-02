import type { CourseId, CourseSummaries } from '@cram/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiResult } from '../api/api-result';

export type SummariesState =
  { readonly status: 'idle' } | { readonly status: 'pending' } | ApiResult<CourseSummaries>;

const IDLE: SummariesState = { status: 'idle' };

/** Read when a summary is first opened, and again once `stamp`, the ingest status's summary state, moves. */
export const useSummaries = (
  api: ApiClient,
  courseId: CourseId,
  stamp: string,
): { readonly state: SummariesState; readonly load: () => void } => {
  const [held, setHeld] = useState<{ readonly stamp: string; readonly state: SummariesState }>({
    stamp,
    state: IDLE,
  });
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );
  const state = held.stamp === stamp ? held.state : IDLE;
  const load = useCallback(() => {
    if (state.status !== 'idle' && state.status !== 'unreachable' && state.status !== 'malformed')
      return;
    const call = ++latest.current;
    setHeld({ stamp, state: { status: 'pending' } });
    void api.summaries(courseId).then((result) => {
      if (call === latest.current) setHeld({ stamp, state: result });
    });
  }, [api, courseId, stamp, state.status]);
  return { state, load };
};
