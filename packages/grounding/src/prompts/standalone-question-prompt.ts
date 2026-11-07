import { type ChatRequest, OutputName } from '@cram/gateway';
import { type AskTurn, NonBlankText } from '@cram/shared';
import { z } from 'zod';
import { turnBlock } from './explanation-prompt';

export const StandaloneQuestion = z.strictObject({ question: NonBlankText });
export type StandaloneQuestion = z.infer<typeof StandaloneQuestion>;

const INSTRUCTIONS = `You rewrite a student's latest question about their lecture slides so that it can be understood on its own, without the conversation before it.
You are given the earlier turns of the conversation, each inside a <turn> tag: what the student asked, inside a <student> tag, then what the tutor answered, inside a <tutor> tag. Then comes the latest question.

Rules:
- Replace each word or phrase in the question that refers to an earlier turn with what the turns show it refers to.
- Keep the student's own wording otherwise. Add nothing the question does not ask, and do not answer it.
- If the question can already be understood on its own, return it unchanged.
- Do not name a lecture or a slide.`;

const STANDALONE_QUESTION = OutputName.parse('standalone-question');

/** A follow-up rewritten for retrieval only (`docs/adr/0011-ask-conversation.md` § Decision (d)); the turns as the explanation prompt shows them. */
export const standaloneRequest = (
  question: string,
  turns: readonly AskTurn[],
): ChatRequest<StandaloneQuestion> => ({
  messages: [
    { role: 'system', content: INSTRUCTIONS },
    {
      role: 'user',
      content: [...turns.map(turnBlock), `<question>${question}</question>`].join('\n\n'),
    },
  ],
  output: { name: STANDALONE_QUESTION, schema: StandaloneQuestion },
});
