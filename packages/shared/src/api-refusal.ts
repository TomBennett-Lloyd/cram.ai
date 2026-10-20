import { z } from 'zod';
import { NonBlankText } from './non-blank-text';

/** Why the server refused a request; `problem` is an `@cram/index` `OpenCourseResult` status. */
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
    ]),
  }),
  z.strictObject({ status: z.literal('bad-request'), issue: NonBlankText }),
  z.strictObject({ status: z.literal('course-unavailable'), problem: NonBlankText }),
  z.strictObject({
    status: z.literal('question-over-length'),
    maxInputTokens: z.number().int().positive(),
  }),
]);
export type ApiRefusal = z.infer<typeof ApiRefusal>;
