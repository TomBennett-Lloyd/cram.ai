import type { AskReply, CourseId } from '@cram/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiResult } from '../api/api-result';

export type AskState =
  { readonly status: 'idle' } | { readonly status: 'pending' } | ApiResult<AskReply>;

/** One question at a time; a reply that lands after a newer question, or after unmount, is dropped. */
export const useAsk = (
  api: ApiClient,
  courseId: CourseId,
): { readonly state: AskState; readonly ask: (question: string) => void } => {
  const [state, setState] = useState<AskState>({ status: 'idle' });
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );
  const ask = useCallback(
    (question: string) => {
      const call = ++latest.current;
      setState({ status: 'pending' });
      void api.ask(courseId, question).then((result) => {
        if (call === latest.current) setState(result);
      });
    },
    [api, courseId],
  );
  return { state, ask };
};
