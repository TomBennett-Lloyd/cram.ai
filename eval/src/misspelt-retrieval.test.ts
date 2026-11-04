import { RETRIEVAL_K } from '@cram/index';
import type { SlideRecord } from '@cram/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IndexRetriever, type IndexedLecture } from './index-retriever';
import { EVAL_COURSE_ID, readEvalCourse } from './read-eval-course';
import { indexedLecture, record } from './run-fixture';
import { ScriptedGateway } from './scripted-gateway-fixture';

// Acceptance for #393 on the synthetic deck: one edit in a course term retrieves what the
// correct spelling does. The embedder is the fixture's letter-count one.
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
  const { embedder } = new ScriptedGateway(() => ({
    status: 'backend-failed',
    cause: 'request-error',
    reason: 'unused',
  }));
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

// docs/adr/0010-misspelt-golden-variants.md § Decision (b): the committed sample's variants inside
// the corrector's bound, and the one beyond it, which is left as typed.
const WITHIN_BOUND = [
  'Are wurker bees male or female?',
  'Which queen leaves the hive with a swram?',
  'How long does caped honey keep?',
  'What is the blom count, and how is it used through the year?',
  "What is the third step of the guild's inspekton checklist?",
];

describe('a committed misspelt variant within the correction bound', () => {
  it.each(WITHIN_BOUND)("retrieves its question's top slides: %s", async (variant) => {
    const golden = read.course.questions.find(({ misspelt }) => misspelt.includes(variant));
    if (golden === undefined) throw new Error(`no committed question carries "${variant}"`);
    expect(await topSlides(variant)).toEqual(await topSlides(golden.question));
  });
});

const BEYOND_BOUND = 'What is the remedy for brood fivr?';

it('keeps a committed misspelt variant beyond the correction bound, left as typed', async () => {
  const golden = read.course.questions.find(({ misspelt }) => misspelt.includes(BEYOND_BOUND));
  if (golden === undefined) throw new Error(`no committed question carries "${BEYOND_BOUND}"`);
  expect(await topSlides(BEYOND_BOUND)).not.toEqual(await topSlides(golden.question));
});
