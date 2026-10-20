import { z } from 'zod';
import { NonBlankText } from './non-blank-text';
import { CourseId, LectureId, SlideNo } from './slide-record';

export const UploadId = z.string().min(1).brand<'UploadId'>();
export type UploadId = z.infer<typeof UploadId>;

const upload = { uploadId: UploadId, lectureId: LectureId, fileName: NonBlankText };

/**
 * One uploaded deck's progress through ingest. An `imageOnly` page is a slide with no text,
 * reported and never an error (ADR 0006 (b), #15). `reason` and `problem` are vocabularies
 * `@cram/ingest` and `@cram/index` own, carried as text so they keep one owner.
 */
export const Upload = z.discriminatedUnion('state', [
  z.strictObject({ ...upload, state: z.literal('queued') }),
  z.strictObject({ ...upload, state: z.literal('ingesting') }),
  z.strictObject({
    ...upload,
    state: z.literal('indexed'),
    slideCount: z.number().int().nonnegative(),
    imageOnly: z.array(SlideNo),
  }),
  z.strictObject({
    ...upload,
    state: z.literal('unreadable'),
    reason: NonBlankText,
    detail: z.string(),
  }),
  z.strictObject({ ...upload, state: z.literal('course-unavailable'), problem: NonBlankText }),
  z.strictObject({ ...upload, state: z.literal('failed') }),
]);
export type Upload = z.infer<typeof Upload>;

export const IngestStatus = z.strictObject({ courseId: CourseId, uploads: z.array(Upload) });
export type IngestStatus = z.infer<typeof IngestStatus>;
