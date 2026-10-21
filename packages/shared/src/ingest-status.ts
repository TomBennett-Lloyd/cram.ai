import { z } from 'zod';
import { NonBlankText } from './non-blank-text';
import { CourseId, LectureId, SlideNo } from './slide-record';

export const UploadId = z.string().min(1).brand<'UploadId'>();
export type UploadId = z.infer<typeof UploadId>;

const INDEXED_SLIDES = {
  slideCount: z.number().int().nonnegative(),
  imageOnly: z.array(SlideNo),
};

/**
 * Where one uploaded deck has got to in ingest. An `imageOnly` page is reported and never an
 * error (ADR 0006 § Decision (b), proposed in #120). An `over-length` deck has slides longer than
 * the embedder takes, which are never truncated, so nothing of it is indexed (#77 splits them). `reason` and `problem`
 * are vocabularies `@cram/ingest` and `@cram/index` own, carried as text to keep one owner each.
 */
export const UploadProgress = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('queued') }),
  z.strictObject({ state: z.literal('ingesting') }),
  z.strictObject({ state: z.literal('indexed'), ...INDEXED_SLIDES }),
  z.strictObject({ state: z.literal('unreadable'), reason: NonBlankText, detail: z.string() }),
  z.strictObject({
    state: z.literal('over-length'),
    slides: z.array(SlideNo).min(1),
    maxInputTokens: z.number().int().positive(),
  }),
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

/** One lecture as its course file holds it, so it is reported after a restart (#146). */
export const StoredLecture = z.strictObject({
  lectureId: LectureId,
  lectureTitle: NonBlankText,
  ...INDEXED_SLIDES,
});
export type StoredLecture = z.infer<typeof StoredLecture>;

/** The course file's lectures, or why it cannot be opened; `problem` is `@cram/index`'s vocabulary. */
export const StoredLectures = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('read'), lectures: z.array(StoredLecture) }),
  z.strictObject({ state: z.literal('course-unavailable'), problem: NonBlankText }),
]);
export type StoredLectures = z.infer<typeof StoredLectures>;

/** `stored` is what the course file holds; `uploads` are those since the server started. */
export const IngestStatus = z.strictObject({
  courseId: CourseId,
  stored: StoredLectures,
  uploads: z.array(Upload),
});
export type IngestStatus = z.infer<typeof IngestStatus>;
