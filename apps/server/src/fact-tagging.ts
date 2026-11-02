import { type FactTagging, type TagFact, tagFacts } from '@cram/grounding';
import {
  type CourseId,
  type CourseUnavailableProblem,
  type LectureId,
  SlideKind,
} from '@cram/shared';
import { openForWrite } from './course-file';
import type { IngestDeps } from './ingest-deck';

export type TaggingOutcome =
  | { readonly status: 'tagged'; readonly facts: readonly FactTagging[] }
  | { readonly status: 'no-such-lecture' }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

/** Tags each chunk of the lecture's slides but a references one, which `search` leaves out (`docs/plan.md` §3.2). */
export const tagStored = async (
  courseId: CourseId,
  lectureId: LectureId,
  deps: IngestDeps,
): Promise<TaggingOutcome> => {
  const opened = openForWrite(deps.files, courseId);
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  const { course } = opened;
  try {
    const lecture = course.lectures().find((stored) => stored.lectureId === lectureId);
    if (lecture === undefined) return { status: 'no-such-lecture' };
    const facts: TagFact[] = course
      .lectureSlides(lectureId)
      .filter(({ record }) => record.kind !== SlideKind.enum.references)
      .flatMap(({ sourceId, record }) =>
        course
          .chunks(sourceId)
          .map((chunk) => ({ sourceId, lectureTitle: record.lectureTitle, chunk })),
      );
    const tagged = await tagFacts(facts, { generator: deps.gateway.generator });
    for (const fact of tagged)
      if (fact.status === 'tagged')
        course.setTopics({ sourceId: fact.sourceId, chunkNo: fact.chunkNo }, 'tagger', fact.tags);
    return { status: 'tagged', facts: tagged };
  } finally {
    course.close();
  }
};

/** `undefined` when nothing failed; never a tag, which is course text (`server-log.ts`). */
export const taggingLogOutcome = (outcome: TaggingOutcome): string | undefined => {
  if (outcome.status !== 'tagged') return outcome.status;
  const failed = outcome.facts.flatMap((fact) =>
    fact.status === 'untagged' && fact.reason !== 'no-text' ? [fact.reason] : [],
  );
  if (failed.length === 0) return undefined;
  return `untagged ${String(failed.length)}/${String(outcome.facts.length)} ${[...new Set(failed)].sort().join(',')}`;
};
