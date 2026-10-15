import { z } from 'zod';
import { NonBlankText } from './non-blank-text';

/** The marks a question is worth, as distinct from marks awarded (`docs/standards/typing.md` rule 1). */
export const MarksAvailable = z.number().int().positive().brand<'MarksAvailable'>();
export type MarksAvailable = z.infer<typeof MarksAvailable>;

/**
 * A sample exam question, parsed for its style and never used as a source of
 * facts (`docs/plan.md` §3.1).
 */
export const StyleExemplar = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('mcq'),
    stem: NonBlankText,
    options: z.array(NonBlankText).min(2),
    marks: MarksAvailable.optional(),
  }),
  z.strictObject({
    type: z.enum(['short', 'essay', 'case']),
    stem: NonBlankText,
    marks: MarksAvailable.optional(),
  }),
]);
export type StyleExemplar = z.infer<typeof StyleExemplar>;
