import { z } from 'zod';

export const CourseId = z.string().min(1).brand<'CourseId'>();
export type CourseId = z.infer<typeof CourseId>;

export const LectureId = z.string().min(1).brand<'LectureId'>();
export type LectureId = z.infer<typeof LectureId>;

/** The slide's page number in its deck, counted from 1 — never an array index. */
export const SlideNo = z.number().int().positive().brand<'SlideNo'>();
export type SlideNo = z.infer<typeof SlideNo>;

export const SourceHash = z.string().min(1).brand<'SourceHash'>();
export type SourceHash = z.infer<typeof SourceHash>;

/**
 * One slide as ingest emits it. Every text field may be empty: a slide with no
 * extractable text is a record, not an error (#9). `derived` marks text produced
 * by OCR or captioning rather than read from the deck (ADR 0006, #6).
 */
export const SlideRecord = z.object({
  courseId: CourseId,
  lectureId: LectureId,
  lectureTitle: z.string().min(1),
  slideNo: SlideNo,
  title: z.string(),
  body: z.string(),
  speakerNotes: z.string(),
  imageCaptions: z.array(z.string()),
  derived: z.boolean(),
  sourceHash: SourceHash,
});
export type SlideRecord = z.infer<typeof SlideRecord>;
