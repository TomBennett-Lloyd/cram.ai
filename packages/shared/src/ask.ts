import { z } from 'zod';
import { SourceId } from './citation';
import { Explanation } from './explanation';
import { NonBlankText } from './non-blank-text';
import { RetrievedSlide } from './retrieved-slide';
import { WithheldSentence } from './withheld';

export const AskRequest = z.strictObject({ question: NonBlankText });
export type AskRequest = z.infer<typeof AskRequest>;

/**
 * `slides` is every slide the reply names, the retrieved set first; `leftOut` is
 * `docs/adr/0009-explanation-answers.md` § Decision (k)'s (and (a)'s). `searched` is the
 * corrected question (#393). `model-failed` carries no model output (rule 1).
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
