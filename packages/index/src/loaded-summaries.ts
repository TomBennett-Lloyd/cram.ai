import type { LectureId, LoadedSummary, RetrievedSlide } from '@cram/shared';
import type { CourseReader } from './open-course';

/** The stored summaries of the ranked slides' lectures, in the rank of each lecture's best slide; a lecture with none loads none. */
export const loadSummaries = (
  course: Pick<CourseReader, 'summary' | 'lectureSlides'>,
  ranked: readonly RetrievedSlide[],
): readonly LoadedSummary[] => {
  const lectures = [...new Set<LectureId>(ranked.map(({ record }) => record.lectureId))];
  return lectures.flatMap((lectureId) => {
    const summary = course.summary(lectureId);
    if (summary === undefined) return [];
    const cited = new Set(
      summary.units.flatMap(({ citations }) => citations.map(({ sourceId }) => sourceId)),
    );
    const slides = course.lectureSlides(lectureId).filter(({ sourceId }) => cited.has(sourceId));
    return [{ summary, slides }];
  });
};
