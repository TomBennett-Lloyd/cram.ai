import { z } from 'zod';
import { CourseUnavailableProblem } from './ingest-status';
import { ChunkTag } from './lecture-slides';
import { NonBlankText } from './non-blank-text';

/** Why the server refused a request; `report-changed` (#299) and `tags-changed` (#507) refuse a write made against state the file no longer holds. */
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
  z.strictObject({ status: z.literal('tags-changed'), tags: z.array(ChunkTag) }),
  z.strictObject({
    status: z.literal('question-over-length'),
    maxInputTokens: z.number().int().positive(),
  }),
]);
export type ApiRefusal = z.infer<typeof ApiRefusal>;
