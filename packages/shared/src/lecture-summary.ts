import { z } from 'zod';
import { CourseUnavailableProblem } from './ingest-status';
import { RetrievedSlide } from './retrieved-slide';
import { LectureId } from './slide-record';
import { Unit } from './unit';

export const SummaryUnit = Unit.extend({ kind: z.literal('lecture-summary') });
export type SummaryUnit = z.infer<typeof SummaryUnit>;

/**
 * A lecture's stored digest, its units in order (`docs/adr/0009-explanation-answers.md` § Decision (l)).
 * Never empty: a lecture with no surviving unit has no summary.
 */
export const LectureSummary = z.strictObject({
  lectureId: LectureId,
  units: z.array(SummaryUnit).min(1),
});
export type LectureSummary = z.infer<typeof LectureSummary>;

/** A request to make a lecture's summary again, from the decks screen. */
export const SummaryRemakeRequest = z.strictObject({ lectureId: LectureId });
export type SummaryRemakeRequest = z.infer<typeof SummaryRemakeRequest>;

/** Every stored summary of a course, with each slide a line cites, so each line can open its slide. */
export const CourseSummaries = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('read'),
    summaries: z.array(LectureSummary),
    slides: z.array(RetrievedSlide),
  }),
  z.strictObject({ state: z.literal('course-unavailable'), problem: CourseUnavailableProblem }),
]);
export type CourseSummaries = z.infer<typeof CourseSummaries>;
