import { type FactTagging, lectureFacts, tagFacts } from '@cram/grounding';
import type { CourseId, CourseUnavailableProblem, LectureId } from '@cram/shared';
import { openForWrite } from './course-file';
import type { IngestDeps } from './ingest-deck';

export type TaggingOutcome =
  | { readonly status: 'tagged'; readonly facts: readonly FactTagging[] }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

export const tagStored = async (
  courseId: CourseId,
  lectureId: LectureId,
  deps: IngestDeps,
): Promise<TaggingOutcome> => {
  const opened = openForWrite(deps.files, courseId);
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  const { course } = opened;
  try {
    const facts = lectureFacts(course.lectureSlides(lectureId), (id) => course.chunks(id));
    const tagged = await tagFacts(facts, { generator: deps.gateway.generator });
    for (const fact of tagged)
      if (fact.status === 'tagged') {
        const set = course.setTopics(
          { sourceId: fact.sourceId, chunkNo: fact.chunkNo },
          'tagger',
          fact.tags,
        );
        if (set.status !== 'set')
          throw new Error(
            `tagStored: ${fact.sourceId} chunk ${String(fact.chunkNo)} was read but is not stored`,
          );
      }
    return { status: 'tagged', facts: tagged };
  } finally {
    course.close();
  }
};

export const taggingLogOutcome = (outcome: TaggingOutcome): string | undefined => {
  if (outcome.status !== 'tagged') return outcome.status;
  const asked = outcome.facts.filter(
    (fact) => fact.status === 'tagged' || fact.reason !== 'no-text',
  );
  const failed = asked.flatMap((fact) => (fact.status === 'untagged' ? [fact.reason] : []));
  if (failed.length === 0) return undefined;
  return `untagged ${String(failed.length)}/${String(asked.length)} ${[...new Set(failed)].sort().join(',')}`;
};
