import { LectureId } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deck,
  embedWhole,
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  type TempCourse,
  vector,
} from './course-fixture';
import type { CourseIndex } from './course-index';
import { EmbedderIdentity } from './embedder-identity';
import { reembedCourse } from './open-course';

// Slides stored as one whole chunk with no vector (`IndexedSlide`, #338).

const AWAY = vector(0, 0, 0, 1);
const LECTURE_1 = LectureId.parse('lecture-1');

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

const bodies = (text: string, embedding: Float32Array, k: number) =>
  course.search({ text, embedding }, k).map((hit) => hit.record.body);

describe('a slide stored without a vector', () => {
  beforeEach(() => {
    indexLectures(course, [
      indexed(slide({ slideNo: 1, body: 'osmosis at length' }), undefined),
      indexed(slide({ slideNo: 2, body: 'diffusion' }), vector(1, 0, 0, 0)),
    ]);
  });

  it('is listed and found by its words', () => {
    expect(course.slides().map(({ body }) => body)).toEqual(['osmosis at length', 'diffusion']);
    expect(bodies('osmosis', vector(1, 0, 0, 0), 1)).toEqual(['osmosis at length']);
  });

  it('is left out of the vector list', () => {
    expect(bodies('', AWAY, 2)).toEqual(['diffusion']);
  });
});

describe('CourseIndex.lectures on slides stored without a vector', () => {
  it('lists each content slide as unembedded, leaving image-only and references slides to their own reports', () => {
    course.replaceLecture(
      deck(),
      [],
      (
        [
          [1, 'content', vector(1, 0, 0, 0)],
          [2, 'content', undefined],
          [3, 'image-only', undefined],
          [4, 'references', undefined],
          [5, 'references', vector(1, 0, 0, 1)],
          [6, 'content', undefined],
        ] as const
      ).map(([slideNo, kind, embedding]) => indexed(slide({ slideNo, kind }), embedding)),
    );
    expect(course.lectures().find(({ lectureId }) => lectureId === LECTURE_1)).toMatchObject({
      slideCount: 6,
      imageOnly: [3],
      unembedded: [2, 6],
    });
  });
});

describe('re-embedding a slide to no vector', () => {
  const NEW = EmbedderIdentity.parse({ model: 'new', dimension: 2 });
  beforeEach(() => {
    indexLectures(course, [
      indexed(slide({ slideNo: 1, body: 'osmosis' }), AWAY),
      indexed(slide({ slideNo: 2, body: 'diffusion' }), AWAY),
    ]);
  });

  it('keeps a slide `replaceEmbedder` names as undefined, and still refuses one it does not name', () => {
    expect(() => {
      course.replaceEmbedder(NEW, [indexed(slide({ slideNo: 1, body: 'osmosis' }), undefined)]);
    }).toThrow(/no embedding for lecture-1\/2/);
    course.replaceEmbedder(NEW, [
      indexed(slide({ slideNo: 1, body: 'osmosis' }), vector(1, 0)),
      indexed(slide({ slideNo: 2, body: 'diffusion' }), undefined),
    ]);
    expect(course.slides()).toHaveLength(2);
    expect(bodies('', vector(0, 1), 2)).toEqual(['osmosis']);
    expect(course.lectures()[0]?.unembedded).toEqual([2]);
  });

  it('keeps a slide `reembedCourse`’s embed returns no vector for', async () => {
    course.close();
    const result = await reembedCourse(
      { ...temp.spec, embedder: NEW },
      embedWhole(() => Promise.resolve([undefined, vector(1, 0)])),
    );
    if (result.status !== 'open') throw new Error(result.status);
    course = result.course;
    expect(course.slides()).toHaveLength(2);
    expect(bodies('', vector(1, 0), 2)).toEqual(['diffusion']);
    expect(course.lectures()[0]?.unembedded).toEqual([1]);
  });
});
