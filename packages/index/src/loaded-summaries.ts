import type { LectureId, LoadedSummary, RetrievedSlide } from '@cram/shared';
import type { SlideListing } from './list-filter';
import type { CourseReader } from './open-course';

/** The ranked lectures' stored summaries, best first, less each unit citing a slide `listing` leaves out (`docs/standards/grounding.md` rule 10). */
export const loadSummaries = (
  course: Pick<CourseReader, 'summary' | 'lectureSlides'>,
  ranked: readonly RetrievedSlide[],
  listing: SlideListing = {},
): readonly LoadedSummary[] => {
  const lectures = [...new Set<LectureId>(ranked.map(({ record }) => record.lectureId))];
  return lectures.flatMap((lectureId) => {
    const summary = course.summary(lectureId);
    if (summary === undefined) return [];
    const listed = course.lectureSlides(lectureId, listing);
    const eligible = new Set(listed.map(({ sourceId }) => sourceId));
    const units = summary.units.filter(({ citations }) =>
      citations.every(({ sourceId }) => eligible.has(sourceId)),
    );
    if (units.length === 0) return [];
    const cited = new Set(
      units.flatMap(({ citations }) => citations.map(({ sourceId }) => sourceId)),
    );
    const slides = listed.filter(({ sourceId }) => cited.has(sourceId));
    return [{ summary: { lectureId, units }, slides }];
  });
};
