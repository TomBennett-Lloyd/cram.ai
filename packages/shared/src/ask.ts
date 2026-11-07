import { z } from 'zod';
import { SourceId } from './citation';
import { Explanation } from './explanation';
import { NonBlankText } from './non-blank-text';
import { RetrievedSlide } from './retrieved-slide';
import { WithheldSentence } from './withheld';

export const AskTurn = z.strictObject({ question: NonBlankText, answer: NonBlankText.nullable() });
export type AskTurn = z.infer<typeof AskTurn>;

/** `turns` are the thread's earlier exchanges, newest last, each `answer` the shown explanation's text or `null` for a not-covered reply (`docs/adr/0011-ask-conversation.md` § Decision (a)). */
export const AskRequest = z.strictObject({
  question: NonBlankText,
  turns: z.array(AskTurn).default([]),
});
export type AskRequest = z.infer<typeof AskRequest>;

/**
 * `slides` is every slide the reply names, the retrieved set first; `leftOut` is `docs/adr/0009-explanation-answers.md` § Decision (k)'s (and (a)'s).
 * `searched` is the text retrieval ran on when it is not the typed question (`docs/adr/0011-ask-conversation.md` § Decision (d); #393). `model-failed` carries no model output (rule 1).
 */
export const AskReply = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('grounded'),
    explanation: Explanation,
    withheld: z.array(WithheldSentence),
    slides: z.array(RetrievedSlide),
    leftOut: z.array(SourceId),
    searched: NonBlankText.optional(),
  }),
  z.strictObject({
    status: z.literal('not-covered'),
    withheld: z.array(WithheldSentence),
    slides: z.array(RetrievedSlide),
    leftOut: z.array(SourceId),
    searched: NonBlankText.optional(),
  }),
  z.strictObject({ status: z.literal('model-failed') }),
]);
export type AskReply = z.infer<typeof AskReply>;
