import { z } from 'zod';
import { NonBlankText } from './non-blank-text';

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** The longest course id; its carriers are `.claude/ledgers/course-id-length.ledger`. */
export const COURSE_ID_MAX_LENGTH = 64;

const COURSE_ID = new RegExp(
  `^[a-z0-9](?:[a-z0-9-]{0,${String(COURSE_ID_MAX_LENGTH - 2)}}[a-z0-9])?$`,
);

export const CourseId = z
  .string()
  .regex(COURSE_ID, 'lowercase letters, digits and inner hyphens')
  .refine((id) => !WINDOWS_DEVICE_NAME.test(id), 'a Windows device name')
  .brand<'CourseId'>();
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
