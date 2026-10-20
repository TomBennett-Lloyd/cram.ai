import { SlideRecord, SourceId, type CourseId } from '@cram/shared';
import { z } from 'zod';

/** `<lectureId>/<slideNo>`: the slide number is a trailing integer, so ids never collide (slide-row.test.ts). */
export const sourceIdOf = (slide: Pick<SlideRecord, 'lectureId' | 'slideNo'>): SourceId =>
  SourceId.parse(`${slide.lectureId}/${String(slide.slideNo)}`);

export const SLIDE_COLUMNS =
  'source_id, lecture_id, lecture_title, slide_no, kind, title, body, speaker_notes, image_captions, derived, source_hash';

const SlideRow = z.object({
  id: z.number().int(),
  source_id: z.string(),
  lecture_id: z.string(),
  lecture_title: z.string(),
  slide_no: z.number(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  speaker_notes: z.string(),
  image_captions: z.string(),
  derived: z.number(),
  source_hash: z.string(),
});

export interface StoredSlide {
  readonly id: number;
  readonly sourceId: SourceId;
  readonly record: SlideRecord;
}

export const slideFromRow = (row: unknown, courseId: CourseId): StoredSlide => {
  const parsed = SlideRow.parse(row);
  return {
    id: parsed.id,
    sourceId: SourceId.parse(parsed.source_id),
    record: SlideRecord.parse({
      courseId,
      lectureId: parsed.lecture_id,
      lectureTitle: parsed.lecture_title,
      slideNo: parsed.slide_no,
      kind: parsed.kind,
      title: parsed.title,
      body: parsed.body,
      speakerNotes: parsed.speaker_notes,
      imageCaptions: JSON.parse(parsed.image_captions) as unknown,
      derived: parsed.derived === 1,
      sourceHash: parsed.source_hash,
    }),
  };
};

/** Bind values in `SLIDE_COLUMNS` order. */
export const slideRowValues = (record: SlideRecord): readonly (string | number)[] => [
  sourceIdOf(record),
  record.lectureId,
  record.lectureTitle,
  record.slideNo,
  record.kind,
  record.title,
  record.body,
  record.speakerNotes,
  JSON.stringify(record.imageCaptions),
  record.derived ? 1 : 0,
  record.sourceHash,
];

/** The FTS5 columns of `slides_fts`, in order. */
export const ftsValues = (record: SlideRecord): readonly string[] => [
  record.lectureTitle,
  record.title,
  record.body,
  record.speakerNotes,
  record.imageCaptions.join('\n'),
];
