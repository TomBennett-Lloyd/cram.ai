import { z } from 'zod';
import { CourseUnavailableProblem } from './ingest-status';
import { NonBlankText } from './non-blank-text';

/** Why the server refused a request; `report-changed` is a dismissal of a rebuild report other than the file's (#299). */
export const ApiRefusal = z.union([
  z.strictObject({
    status: z.enum([
      'forbidden',
      'not-found',
      'method-not-allowed',
      'payload-too-large',
      'unsupported-media-type',
      'no-such-course',
      'internal-error',
      'report-changed',
    ]),
  }),
  z.strictObject({ status: z.literal('bad-request'), issue: NonBlankText }),
  z.strictObject({ status: z.literal('course-unavailable'), problem: CourseUnavailableProblem }),
  z.strictObject({
    status: z.literal('question-over-length'),
    maxInputTokens: z.number().int().positive(),
  }),
]);
export type ApiRefusal = z.infer<typeof ApiRefusal>;
