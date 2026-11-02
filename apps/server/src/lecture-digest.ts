import {
  PROVISIONAL_NLI_THRESHOLDS,
  PROVISIONAL_VERIFIER_STRATEGY,
  summariseLecture,
  type SummaryOutcome,
} from '@cram/grounding';
import type { CourseId, CourseUnavailableProblem, LectureId } from '@cram/shared';
import { openForWrite } from './course-file';
import type { IngestDeps } from './ingest-deck';

export type DigestOutcome =
  | SummaryOutcome
  | { readonly status: 'no-such-lecture' }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

/** Upload, rebuild and re-make all summarise here (`docs/adr/0009-explanation-answers.md` § Decision (l)). */
export const summariseStored = async (
  courseId: CourseId,
  lectureId: LectureId,
  deps: IngestDeps,
): Promise<DigestOutcome> => {
  const opened = openForWrite(deps.files, courseId);
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  const { course } = opened;
  try {
    const lecture = course.lectures().find((stored) => stored.lectureId === lectureId);
    if (lecture === undefined) return { status: 'no-such-lecture' };
    const outcome = await summariseLecture(lecture, course.lectureSlides(lectureId), {
      gateway: deps.gateway,
      strategy: PROVISIONAL_VERIFIER_STRATEGY,
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
    });
    if (outcome.status === 'summarised') course.setSummary(outcome.summary);
    return outcome;
  } finally {
    course.close();
  }
};
