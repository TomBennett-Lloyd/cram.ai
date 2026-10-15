import { z } from 'zod';

const marks = z.number().int().positive().optional();

/**
 * A sample exam question, parsed for its style and never used as a source of
 * facts (`docs/plan.md` §3.1). Only `mcq` carries options; the strict objects
 * refuse options on any other type.
 */
export const StyleExemplar = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('mcq'),
    stem: z.string().regex(/\S/),
    options: z.array(z.string().regex(/\S/)).min(2),
    marks,
  }),
  z.strictObject({
    type: z.enum(['short', 'essay', 'case']),
    stem: z.string().regex(/\S/),
    marks,
  }),
]);
export type StyleExemplar = z.infer<typeof StyleExemplar>;
