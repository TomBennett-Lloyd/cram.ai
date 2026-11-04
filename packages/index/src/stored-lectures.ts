import type { Database } from 'better-sqlite3';
import { SlideKind, StoredLecture } from '@cram/shared';
import { z } from 'zod';
import { LECTURE_SUMMARY_TABLE_NAME, SUMMARISED_LECTURES } from './lecture-summaries';

/** A deck and one of its slides; a deck with no slides is one row with no slide. */
const LectureSlideRow = z.object({
  lecture_id: z.string(),
  lecture_title: z.string(),
  slide_no: z.number().nullable(),
  kind: SlideKind.nullable(),
  embedded: z.number().nullable(),
  summarised: z.number(),
  withheld: z.number(),
});

const LECTURE_SLIDES = `select decks.lecture_id, decks.lecture_title, slides.slide_no, slides.kind,
    slides.id in (select slide_id from chunks where id in (select rowid from slide_vec)) as embedded,
    decks.lecture_id in (${SUMMARISED_LECTURES}) as summarised,
    coalesce((select json_array_length(withheld) from ${LECTURE_SUMMARY_TABLE_NAME}
      where lecture_id = decks.lecture_id), 0) as withheld
  from decks left join slides on slides.lecture_id = decks.lecture_id
  order by decks.lecture_id, slides.slide_no`;

/**
 * Every lecture with a deck, by lecture id: title, slide count, `image-only` slides, other slides with no vector (`IndexedSlide`,
 * #338), whether it is summarised, and how many summary units it withheld. A `references` slide is never in `unembedded`: search leaves it out of the vector list
 * unless asked (`SearchQuery.includeReferences`).
 */
export const storedLectures = (db: Database): readonly StoredLecture[] => {
  const lectures = new Map<string, z.input<typeof StoredLecture>>();
  for (const row of db.prepare(LECTURE_SLIDES).all()) {
    const { lecture_id, lecture_title, slide_no, kind, embedded, summarised, withheld } =
      LectureSlideRow.parse(row);
    const lecture = lectures.get(lecture_id) ?? {
      lectureId: lecture_id,
      lectureTitle: lecture_title,
      slideCount: 0,
      imageOnly: [],
      unembedded: [],
      summarised: summarised === 1,
      withheld,
    };
    lectures.set(lecture_id, lecture);
    if (slide_no === null) continue;
    lecture.slideCount += 1;
    if (kind === SlideKind.enum['image-only']) lecture.imageOnly.push(slide_no);
    if (embedded === 0 && kind === SlideKind.enum.content) lecture.unembedded.push(slide_no);
  }
  return [...lectures.values()].map((lecture) => StoredLecture.parse(lecture));
};
