import { z } from 'zod';
import { NonBlankText } from './non-blank-text';
import { CourseId, LectureId, SlideNo } from './slide-record';

export const UploadId = z.string().min(1).brand<'UploadId'>();
export type UploadId = z.infer<typeof UploadId>;

/** Each `@cram/index` `OpenCourseResult` status but `open`, which the server assigns here (#299). */
export const CourseUnavailableProblem = z.enum([
  'newer-schema',
  'older-schema',
  'not-a-course-file',
  'course-mismatch',
  'embedder-mismatch',
]);
export type CourseUnavailableProblem = z.infer<typeof CourseUnavailableProblem>;

const INDEXED_SLIDES = {
  slideCount: z.number().int().nonnegative(),
  imageOnly: z.array(SlideNo),
};

/**
 * Where one uploaded deck has got to in ingest. An `imageOnly` page is reported and never an
 * error (ADR 0006 § Decision (b), proposed in #120). An `over-length` deck has slides longer than
 * the embedder takes, which are never truncated, so nothing of it is indexed (#77 splits them). `reason` is
 * `@cram/ingest`'s vocabulary, carried as text to keep one owner.
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
  z.strictObject({ state: z.literal('course-unavailable'), problem: CourseUnavailableProblem }),
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

/**
 * The tables a rebuild discards from a current file, held to the schema by `packages/index/src/schema.test.ts`
 * (`.claude/ledgers/topics-table.ledger`, `confirmations-table.ledger`). A renamed table keeps its member (#299).
 */
export const DiscardableTable = z.enum(['topics', 'confirmations']);
export type DiscardableTable = z.infer<typeof DiscardableTable>;

/** A table of an older course file whose rows a rebuild did not carry over; that file can hold any table. */
export const DiscardedTable = z.strictObject({
  table: NonBlankText,
  rows: z.number().int().positive(),
});
export type DiscardedTable = z.infer<typeof DiscardedTable>;

/** Names one undismissed report by its rows, so a dismissal clears only the report the student saw (#299). */
export const RebuildReportRevision = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'RebuildReportRevision'>();
export type RebuildReportRevision = z.infer<typeof RebuildReportRevision>;

/** What rebuilds discarded that the student has not dismissed (#233). */
export const RebuildReport = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('none') }),
  z.strictObject({
    state: z.literal('undismissed'),
    discarded: z.array(DiscardedTable).min(1),
    revision: RebuildReportRevision,
  }),
]);
export type RebuildReport = z.infer<typeof RebuildReport>;

/** The course file's lectures and rebuild report, or why it cannot be opened. */
export const StoredLectures = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('read'),
    lectures: z.array(StoredLecture),
    report: RebuildReport,
  }),
  z.strictObject({ state: z.literal('course-unavailable'), problem: CourseUnavailableProblem }),
]);
export type StoredLectures = z.infer<typeof StoredLectures>;

/**
 * The course file's start-up repair (#225). `none` is a course with no repair since the server
 * started; `failed` leaves the file as `stored` reports it.
 */
export const CourseRepair = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('none') }),
  z.strictObject({ state: z.literal('queued') }),
  z.strictObject({ state: z.literal('running') }),
  z.strictObject({ state: z.literal('done') }),
  z.strictObject({ state: z.literal('failed') }),
]);
export type CourseRepair = z.infer<typeof CourseRepair>;

/** `stored` is what the course file holds; `repair` and `uploads` are since the server started. */
export const IngestStatus = z.strictObject({
  courseId: CourseId,
  stored: StoredLectures,
  repair: CourseRepair,
  uploads: z.array(Upload),
});
export type IngestStatus = z.infer<typeof IngestStatus>;

export const RebuildReportDismissed = z.strictObject({ status: z.literal('dismissed') });
export type RebuildReportDismissed = z.infer<typeof RebuildReportDismissed>;
