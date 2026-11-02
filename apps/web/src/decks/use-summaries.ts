import type { CourseId, CourseSummaries } from '@cram/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiResult } from '../api/api-result';

export type SummariesState =
  { readonly status: 'idle' } | { readonly status: 'pending' } | ApiResult<CourseSummaries>;

const IDLE: SummariesState = { status: 'idle' };

/** Read when a summary is first opened; once `stamp` moves, the lines read stay shown until the next open reads them again. */
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
  const { state } = held;
  const settled = state.status === 'ok' || state.status === 'refused';
  const current = held.stamp === stamp && settled;
  const load = useCallback(() => {
    if (state.status === 'pending' || current) return;
    const call = ++latest.current;
    setHeld({ stamp, state: { status: 'pending' } });
    void api.summaries(courseId).then((result) => {
      if (call === latest.current) setHeld({ stamp, state: result });
    });
  }, [api, courseId, stamp, state.status, current]);
  return { state, load };
};
