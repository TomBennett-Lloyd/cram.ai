import { z } from 'zod';
import { SourceId } from './citation';
import { NonBlankText } from './non-blank-text';
import { Unit } from './unit';
import { PartialPolicy, WithheldReason } from './verification';

const { enum: reason } = WithheldReason;

/** One withheld-report entry (`docs/standards/grounding.md` rules 4 and 7): the unit, why, and for `partial` the policy applied. */
export const WithheldUnit = z.discriminatedUnion('reason', [
  z.strictObject({ reason: z.literal(reason['dangling-citation']), unit: Unit }),
  z.strictObject({ reason: z.literal(reason.partial), policy: PartialPolicy, unit: Unit }),
  z.strictObject({ reason: z.literal(reason.unsupported), unit: Unit }),
]);
export type WithheldUnit = z.infer<typeof WithheldUnit>;

/** An explanation's withheld sentence, or its dropped quote pointer (`docs/adr/0009-explanation-answers.md` § Decision (h)). */
export const WithheldSentence = z.discriminatedUnion('reason', [
  z.strictObject({
    reason: z.literal(reason.contradicted),
    text: NonBlankText,
    sourceId: SourceId,
  }),
  z.strictObject({ reason: z.literal(reason.unsupported), text: NonBlankText }),
  z.strictObject({ reason: z.literal(reason.ungrounded), text: NonBlankText }),
  z.strictObject({
    reason: z.literal(reason['dangling-citation']),
    text: NonBlankText,
    sourceId: SourceId,
  }),
]);
export type WithheldSentence = z.infer<typeof WithheldSentence>;
