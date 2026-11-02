import { ChunkNo, type SlideRecord, TopicTag } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  type TempCourse,
  vector,
} from './course-fixture';
import { CANDIDATES_PER_LIST, type CourseIndex, type SearchQuery } from './course-index';
import { sourceIdOf } from './slide-row';
import type { TopicOrigin } from './topics';

// Topic membership, the third list `search` fuses (`docs/adr/0009-explanation-answers.md` § Decision (n); #369).

const NEAR = vector(1, 0, 0, 0);
const AWAY = vector(0, 0, 0, 1);

let temp: TempCourse;
let course: CourseIndex;
beforeEach(() => {
  temp = tempCourse();
  course = openOrFail(temp.spec);
});
afterEach(() => {
  course.close();
  temp.remove();
});

const tagFirstChunk = (record: SlideRecord, origin: TopicOrigin, ...tags: string[]) => {
  const result = course.setTopics(
    { sourceId: sourceIdOf(record), chunkNo: ChunkNo.parse(1) },
    origin,
    tags.map((tag) => TopicTag.parse(tag)),
  );
  expect(result).toEqual({ status: 'set' });
};
const found = (query: SearchQuery, k: number): readonly string[] =>
  course.search(query, k).map(({ sourceId }) => sourceId);

describe('a question naming a topic', () => {
  const diabetes = slide({
    lectureId: 'lecture-1',
    slideNo: 1,
    body: 'Diabetes is a disorder of blood glucose control',
  });
  const insulin = slide({
    lectureId: 'lecture-1',
    slideNo: 2,
    body: 'Insulin lowers blood glucose',
  });
  const metformin = slide({
    lectureId: 'lecture-2',
    lectureTitle: 'Pharmacology',
    slideNo: 1,
    title: 'Drug interactions',
    body: 'Metformin with iodinated contrast agents risks lactic acidosis',
  });
  const warfarin = slide({
    lectureId: 'lecture-2',
    lectureTitle: 'Pharmacology',
    slideNo: 2,
    body: 'Warfarin with aspirin raises bleeding risk',
  });
  const question = { text: 'what does this course say about diabetes', embedding: NEAR };

  beforeEach(() => {
    indexLectures(course, [
      indexed(diabetes, NEAR),
      indexed(insulin, vector(0.9, 0.1, 0, 0)),
      indexed(metformin, AWAY),
      indexed(warfarin, vector(0, 0, 1, 0)),
    ]);
  });

  it('reaches an example tagged with it on a slide about something else, which words and vectors miss', () => {
    expect(found(question, 2)).not.toContain(sourceIdOf(metformin));
    tagFirstChunk(metformin, 'tagger', 'drug interactions', 'diabetes');
    expect(found(question, 2)).toEqual([sourceIdOf(diabetes), sourceIdOf(metformin)]);
  });

  it('counts a student’s tag as the tagger’s', () => {
    tagFirstChunk(metformin, 'student', 'diabetes');
    expect(found(question, 2)).toContain(sourceIdOf(metformin));
  });

  it('leaves the ranking alone for a question that names no stored tag', () => {
    const kidneys = { text: 'what does this course say about kidneys', embedding: NEAR };
    const before = found(kidneys, 4);
    tagFirstChunk(metformin, 'tagger', 'diabetes');
    expect(found(kidneys, 4)).toEqual(before);
  });
});

describe('the topic list', () => {
  const tagged = (slideNo: number, overrides: Parameters<typeof slide>[0] = {}) =>
    slide({ slideNo, body: `fact ${String(slideNo)}`, ...overrides });

  it('leaves out references and, for exams, unconfirmed derived slides, as the other lists do', () => {
    const references = tagged(1, { kind: 'references' });
    const derived = tagged(2, { derived: true });
    indexLectures(course, [indexed(references, undefined), indexed(derived, undefined)]);
    tagFirstChunk(references, 'tagger', 'diabetes');
    tagFirstChunk(derived, 'tagger', 'diabetes');
    const query = { text: 'diabetes', embedding: AWAY };
    expect(found(query, 2)).toEqual([sourceIdOf(derived)]);
    expect([...found({ ...query, includeReferences: true }, 2)].sort()).toEqual(
      [sourceIdOf(references), sourceIdOf(derived)].sort(),
    );
    expect(found({ ...query, excludeUnconfirmedDerived: true }, 2)).toEqual([]);
  });

  it('ranks a fact holding more of the named tags first, counting a tag both origins wrote once', () => {
    const both = tagged(1);
    const two = tagged(2);
    indexLectures(course, [indexed(both, undefined), indexed(two, undefined)]);
    tagFirstChunk(both, 'tagger', 'diabetes');
    tagFirstChunk(both, 'student', 'diabetes');
    tagFirstChunk(two, 'tagger', 'diabetes', 'insulin');
    expect(found({ text: 'diabetes and insulin', embedding: AWAY }, 2)).toEqual([
      sourceIdOf(two),
      sourceIdOf(both),
    ]);
  });

  it('ranks facts holding as many named tags by their place in the vector list, not their order of indexing', () => {
    // By vector rank the topic list is [nearest, middle, far] and nearest leads the fusion; by indexing order it
    // would be [middle, far, nearest], and middle would.
    const middle = tagged(1);
    const far = tagged(2);
    const nearest = tagged(3);
    const untagged = tagged(4);
    indexLectures(course, [
      indexed(middle, vector(1, 0.5, 0, 0)),
      indexed(far, vector(1, 1, 0, 0)),
      indexed(nearest, vector(1, 0.1, 0, 0)),
      indexed(untagged, NEAR),
    ]);
    for (const record of [middle, far, nearest]) tagFirstChunk(record, 'tagger', 'diabetes');
    expect(found({ text: 'diabetes', embedding: NEAR }, 1)).toEqual([sourceIdOf(nearest)]);
  });

  it('reads at most CANDIDATES_PER_LIST tagged facts, so a fact past them gains nothing from its tag', () => {
    // Unembedded, so only the words and topic lists rank them. Past the cut, the last tagged fact would add
    // 1 / (RRF_K + 51) to its second place in the words list and overtake their first place.
    const firsts = Array.from({ length: CANDIDATES_PER_LIST }, (_, index) => tagged(index + 1));
    const wordy = tagged(CANDIDATES_PER_LIST + 1, { body: 'glucose glucose' });
    const last = tagged(CANDIDATES_PER_LIST + 2, { body: 'glucose in the blood of a patient' });
    indexLectures(
      course,
      [...firsts, wordy, last].map((record) => indexed(record, undefined)),
    );
    for (const record of [...firsts, last]) tagFirstChunk(record, 'tagger', 'diabetes');
    expect(found({ text: 'diabetes glucose', embedding: NEAR }, 1)).toEqual([sourceIdOf(wordy)]);
  });
});
