import { z } from 'zod';
import { NonBlankText } from './non-blank-text';
import { RetrievedSlide } from './retrieved-slide';
import { Unit } from './unit';
import { WithheldUnit } from './withheld';

export const AskRequest = z.strictObject({ question: NonBlankText });
export type AskRequest = z.infer<typeof AskRequest>;

/**
 * The server's answer to an `AskRequest`. `slides` is the call's retrieved set, best first: what
 * the citations name, and the closest slides when nothing survives (`docs/standards/grounding.md`
 * rule 5). `model-failed` carries no model output, which is not a unit (rule 1).
 */
export const AskReply = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('grounded'),
    shown: z.array(Unit).min(1),
    withheld: z.array(WithheldUnit),
    slides: z.array(RetrievedSlide),
  }),
  z.strictObject({
    status: z.literal('not-covered'),
    withheld: z.array(WithheldUnit),
    slides: z.array(RetrievedSlide),
  }),
  z.strictObject({ status: z.literal('model-failed') }),
]);
export type AskReply = z.infer<typeof AskReply>;
