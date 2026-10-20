import { z } from 'zod';
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
