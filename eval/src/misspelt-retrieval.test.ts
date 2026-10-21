import { RETRIEVAL_K } from '@cram/index';
import type { SlideRecord } from '@cram/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IndexRetriever, type IndexedLecture } from './index-retriever';
import { EVAL_COURSE_ID, readEvalCourse } from './read-eval-course';
import { indexedLecture, record } from './run-fixture';
import { ScriptedGateway } from './scripted-gateway-fixture';

// Acceptance for #393 on the synthetic deck: one edit in a course term retrieves what the
// correct spelling does. The embedder is the fixture's letter-count one, so both lists run.
const read = readEvalCourse();
if (read.status !== 'read') throw new Error(`${read.where}: ${read.message}`);

const lectures: readonly IndexedLecture[] = read.course.deck.map((lecture) => {
  const slides: readonly SlideRecord[] = lecture.slides
    .filter(({ imageOnly }) => !imageOnly)
    .map((slide) =>
      record({
        courseId: EVAL_COURSE_ID,
        lectureId: lecture.lectureId,
        lectureTitle: lecture.lectureTitle,
        slideNo: slide.slideNo,
        title: slide.title,
        body: slide.body.join('\n'),
        speakerNotes: slide.speakerNotes,
      }),
    );
  return { ...indexedLecture(lecture.lectureId, slides), slides };
});

let retriever: IndexRetriever;
beforeAll(async () => {
  const { embedder } = new ScriptedGateway(() => ({ status: 'backend-failed', reason: 'unused' }));
  retriever = await IndexRetriever.open({
    courseId: EVAL_COURSE_ID,
    lectures,
    embedder,
    k: RETRIEVAL_K,
  });
});
afterAll(() => {
  retriever.close();
});

const topSlides = async (question: string): Promise<readonly string[]> =>
  (await retriever.retrieve(question)).map(({ sourceId }) => sourceId);

describe('a question with one typo in a course term, on the synthetic deck', () => {
  it.each([
    ['a substitution', 'Are worker bees male or female?', 'Are wirker bees male or female?'],
    [
      'a transposition',
      'Which colours can foragers see best?',
      'Which colours can foraegrs see best?',
    ],
    [
      'a missing letter',
      'What is the remedy for brood fever?',
      'What is the remedy for brood fevr?',
    ],
  ])('retrieves the same top slides as the correct spelling, for %s', async (_, clean, typo) => {
    const expected = await topSlides(clean);
    expect(expected).toHaveLength(RETRIEVAL_K);
    expect(await topSlides(typo)).toEqual(expected);
  });
});
