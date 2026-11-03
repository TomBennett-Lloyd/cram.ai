import { ChunkNo, SourceId, TopicTag } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chunked,
  firstFact,
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  type TempCourse,
  vector,
} from './course-fixture';
import type { CourseIndex } from './course-index';
import { sourceIdOf } from './slide-row';

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

const AWAY = vector(0, 0, 0, 1);

describe('CourseIndex.editTopics', () => {
  const first = sourceIdOf(slide({ slideNo: 1 }));
  const second = sourceIdOf(slide({ slideNo: 2 }));
  const secondChunk = { sourceId: second, chunkNo: ChunkNo.parse(2) };
  const tags = (...texts: string[]) => texts.map((text) => TopicTag.parse(text));
  beforeEach(() => {
    indexLectures(course, [
      chunked(slide({ slideNo: 2, body: 'second\nsecond again' }), AWAY, AWAY),
      indexed(slide({ slideNo: 1, body: 'first' }), AWAY),
    ]);
    course.setTopics(firstFact(second), 'tagger', tags('cells', 'water'));
    course.setTopics(firstFact(second), 'student', tags('osmosis'));
    course.setTopics(secondChunk, 'tagger', tags('pressure'));
  });

  it('removes a listed-out tag of either origin, keeps a held one’s origin, and adds a new one as the student’s', () => {
    expect(course.editTopics(firstFact(second), tags('water', 'diffusion'))).toEqual({
      status: 'set',
    });
    expect(course.topics(second)).toEqual([
      { chunkNo: 1, origin: 'student', tag: 'diffusion' },
      { chunkNo: 1, origin: 'tagger', tag: 'water' },
      { chunkNo: 2, origin: 'tagger', tag: 'pressure' },
    ]);
  });

  it('keeps a tag both origins hold as both, and clears every row of a fact given none', () => {
    course.setTopics(firstFact(second), 'student', tags('osmosis', 'cells'));
    course.editTopics(firstFact(second), tags('cells'));
    expect(course.topics(second).filter(({ chunkNo }) => chunkNo === 1)).toEqual([
      { chunkNo: 1, origin: 'student', tag: 'cells' },
      { chunkNo: 1, origin: 'tagger', tag: 'cells' },
    ]);
    course.editTopics(firstFact(second), []);
    expect(course.topics(second)).toEqual([{ chunkNo: 2, origin: 'tagger', tag: 'pressure' }]);
  });

  it('stores a new tag given twice once, and tells tags apart by their exact text', () => {
    course.editTopics(firstFact(first), tags('Cells', 'cells', 'Cells'));
    expect(course.topics(first)).toEqual([
      { chunkNo: 1, origin: 'student', tag: 'Cells' },
      { chunkNo: 1, origin: 'student', tag: 'cells' },
    ]);
  });

  it('reports a fact the course does not hold and writes nothing', () => {
    for (const fact of [
      firstFact(SourceId.parse('lecture-9/1')),
      { sourceId: first, chunkNo: ChunkNo.parse(2) },
    ])
      expect(course.editTopics(fact, tags('cells'))).toEqual({ status: 'no-such-fact' });
    expect(course.topics(first)).toEqual([]);
  });
});
