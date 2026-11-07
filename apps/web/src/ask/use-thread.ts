import type { AskReply, AskTurn, CourseId } from '@cram/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiResult } from '../api/api-result';

export interface Exchange {
  readonly question: string;
  readonly state: { readonly status: 'pending' } | ApiResult<AskReply>;
}

/** Only an answer the student was shown becomes a turn (`docs/adr/0011-ask-conversation.md` § Decision (a)). */
const turnOf = ({ question, state }: Exchange): AskTurn[] => {
  if (state.status !== 'ok') return [];
  const reply = state.value;
  if (reply.status === 'grounded') return [{ question, answer: reply.explanation.text }];
  return reply.status === 'not-covered' ? [{ question, answer: null }] : [];
};

/** A session-only thread; a newer question replaces a pending one, and a reply that lands after it, a reset or unmount is dropped. */
export const useThread = (
  api: ApiClient,
  courseId: CourseId,
): {
  readonly exchanges: readonly Exchange[];
  readonly ask: (question: string) => void;
  readonly reset: () => void;
} => {
  const [exchanges, setExchanges] = useState<readonly Exchange[]>([]);
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
      const settled = exchanges.filter(({ state }) => state.status !== 'pending');
      setExchanges([...settled, { question, state: { status: 'pending' } }]);
      void api.ask(courseId, { question, turns: settled.flatMap(turnOf) }).then((result) => {
        if (call === latest.current) setExchanges([...settled, { question, state: result }]);
      });
    },
    [api, courseId, exchanges],
  );
  const reset = useCallback(() => {
    latest.current += 1;
    setExchanges([]);
  }, []);
  return { exchanges, ask, reset };
};
