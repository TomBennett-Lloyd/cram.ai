import { z } from 'zod';
import { CourseUnavailableProblem } from './ingest-status';
import { RetrievedSlide } from './retrieved-slide';
import { LectureId } from './slide-record';
import { Unit } from './unit';
import { WithheldUnit } from './withheld';

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

/** A lecture's last completed summary run: its lines, and the units withheld from them (#467); only `LectureSummary` enters a prompt. */
export const LectureDigest = z.strictObject({
  lectureId: LectureId,
  units: z.array(SummaryUnit),
  withheld: z.array(WithheldUnit),
});
export type LectureDigest = z.infer<typeof LectureDigest>;

/** A stored summary as a prompt loads it, beside the slides its units cite (`docs/adr/0009-explanation-answers.md` § Decision (b)). */
export interface LoadedSummary {
  readonly summary: LectureSummary;
  readonly slides: readonly RetrievedSlide[];
}

/** A request to make a lecture's summary again, from the decks screen. */
export const SummaryRemakeRequest = z.strictObject({ lectureId: LectureId });
export type SummaryRemakeRequest = z.infer<typeof SummaryRemakeRequest>;

/** Every stored digest of a course, with each slide a line or withheld unit cites, so each can open its slide. */
export const CourseSummaries = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('read'),
    summaries: z.array(LectureDigest),
    slides: z.array(RetrievedSlide),
  }),
  z.strictObject({ state: z.literal('course-unavailable'), problem: CourseUnavailableProblem }),
]);
export type CourseSummaries = z.infer<typeof CourseSummaries>;
