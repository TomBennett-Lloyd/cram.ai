import type { Generator } from '@cram/gateway';
import type { AskTurn } from '@cram/shared';
import type { ModelFailure } from './model-failure';
import { standaloneRequest } from './prompts/standalone-question-prompt';

export type StandaloneOutcome =
  | { readonly status: 'rewritten'; readonly question: string }
  | { readonly status: 'model-failed'; readonly failure: ModelFailure };

/**
 * The follow-up `question` rewritten to stand alone, for retrieval only
 * (`docs/adr/0011-ask-conversation.md` § Decision (d)). `turns` are as `carriedTurns` returns
 * them and are never empty: a question with no earlier turn is not a follow-up, so an empty
 * list is the caller's bug and throws.
 */
export const standaloneQuestion = async (
  question: string,
  turns: readonly AskTurn[],
  generator: Pick<Generator, 'chat'>,
): Promise<StandaloneOutcome> => {
  if (turns.length === 0) throw new Error('standaloneQuestion: no earlier turn to rewrite from');
  const reply = await generator.chat(standaloneRequest(question, turns));
  return reply.status === 'completed'
    ? { status: 'rewritten', question: reply.value.question }
    : { status: 'model-failed', failure: reply };
};
