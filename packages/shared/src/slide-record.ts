import { z } from 'zod';
import { NonBlankText } from './non-blank-text';

export const CourseId = z.string().min(1).brand<'CourseId'>();
export type CourseId = z.infer<typeof CourseId>;

export const LectureId = z.string().min(1).brand<'LectureId'>();
export type LectureId = z.infer<typeof LectureId>;

/** The slide's page number in its deck, counted from 1 — never an array index. */
export const SlideNo = z.number().int().positive().brand<'SlideNo'>();
export type SlideNo = z.infer<typeof SlideNo>;

export const SourceHash = z.string().min(1).brand<'SourceHash'>();
export type SourceHash = z.infer<typeof SourceHash>;

export const SlideKind = z.enum(['content', 'references', 'image-only']);
export type SlideKind = z.infer<typeof SlideKind>;

/**
 * One slide as ingest emits it. A slide with no extractable text is an `image-only`
 * record, not an error (#9). `derived` marks text produced by OCR or captioning rather
 * than read from the deck (ADR 0006, #6).
 */
export const SlideRecord = z.object({
  courseId: CourseId,
  lectureId: LectureId,
  lectureTitle: NonBlankText,
  slideNo: SlideNo,
  kind: SlideKind,
  title: z.string(),
  body: z.string(),
  speakerNotes: z.string(),
  imageCaptions: z.array(z.string()),
  derived: z.boolean(),
  sourceHash: SourceHash,
});
export type SlideRecord = z.infer<typeof SlideRecord>;
