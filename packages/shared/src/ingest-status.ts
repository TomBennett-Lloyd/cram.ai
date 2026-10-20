import { z } from 'zod';
import { NonBlankText } from './non-blank-text';
import { CourseId, LectureId, SlideNo } from './slide-record';

export const UploadId = z.string().min(1).brand<'UploadId'>();
export type UploadId = z.infer<typeof UploadId>;

/**
 * Where one uploaded deck has got to in ingest. An `imageOnly` page is reported and never an
 * error (ADR 0006 § Decision (b), proposed in #120). `reason` and `problem`
 * are vocabularies `@cram/ingest` and `@cram/index` own, carried as text to keep one owner each.
 */
export const UploadProgress = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('queued') }),
  z.strictObject({ state: z.literal('ingesting') }),
  z.strictObject({
    state: z.literal('indexed'),
    slideCount: z.number().int().nonnegative(),
    imageOnly: z.array(SlideNo),
  }),
  z.strictObject({ state: z.literal('unreadable'), reason: NonBlankText, detail: z.string() }),
  z.strictObject({ state: z.literal('course-unavailable'), problem: NonBlankText }),
  z.strictObject({ state: z.literal('failed') }),
]);
export type UploadProgress = z.infer<typeof UploadProgress>;

export const Upload = z.strictObject({
  uploadId: UploadId,
  lectureId: LectureId,
  fileName: NonBlankText,
  progress: UploadProgress,
});
export type Upload = z.infer<typeof Upload>;

export const IngestStatus = z.strictObject({ courseId: CourseId, uploads: z.array(Upload) });
export type IngestStatus = z.infer<typeof IngestStatus>;
