import { z } from 'zod';
import { NonBlankText } from './non-blank-text';
import { RetrievedSlide } from './retrieved-slide';
import { Unit } from './unit';
import { WithheldUnit } from './withheld';

export const AskRequest = z.strictObject({ question: NonBlankText });
export type AskRequest = z.infer<typeof AskRequest>;

/**
 * `slides` is the call's retrieved set, best first: the citations' slides, or the closest when
 * none survives (`docs/standards/grounding.md` rule 5). `searched` is the question as corrected,
 * only when a typo was (#393). `model-failed` carries no model output, not a unit (rule 1).
 */
export const AskReply = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('grounded'),
    shown: z.array(Unit).min(1),
    withheld: z.array(WithheldUnit),
    slides: z.array(RetrievedSlide),
    searched: NonBlankText.optional(),
  }),
  z.strictObject({
    status: z.literal('not-covered'),
    withheld: z.array(WithheldUnit),
    slides: z.array(RetrievedSlide),
    searched: NonBlankText.optional(),
  }),
  z.strictObject({ status: z.literal('model-failed') }),
]);
export type AskReply = z.infer<typeof AskReply>;
