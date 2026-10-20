import { LectureId, SlideNo, SourceId } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deck,
  indexed,
  openOrFail,
  slide,
  slideImage,
  tempCourse,
  text,
  vector,
  type TempCourse,
} from './course-fixture';
import type { CourseIndex, IndexedSlide } from './course-index';

const LECTURE_1 = LectureId.parse('lecture-1');
const LECTURE_2 = LectureId.parse('lecture-2');
const OTHER = vector(0, 0, 0, 1);
const TAIL = vector(0, 0, 1, 0);

/** Lecture 1's slides 1..n; slide 3, when present, is the tail a shorter deck drops. */
const lectureOne = (bodies: readonly string[]): IndexedSlide[] =>
  bodies.map((body, i) =>
    indexed(slide({ slideNo: i + 1, body }), i === 2 ? TAIL : vector(1, 0, 0, i)),
  );

let temp: TempCourse;
let course: CourseIndex;
beforeEach(() => {
  temp = tempCourse();
  course = openOrFail(temp.spec);
  course.replaceLecture(
    deck({ lectureId: 'lecture-2', lectureTitle: 'Lecture 2' }),
    [slideImage(1, 'enzymes image')],
    [indexed(slide({ lectureId: 'lecture-2', lectureTitle: 'Lecture 2', body: 'enzymes' }), OTHER)],
  );
  course.replaceLecture(
    deck({ content: new TextEncoder().encode('old deck') }),
    [slideImage(1, 'old one'), slideImage(3, 'old three')],
    lectureOne(['alpha', 'beta', 'gamma']),
  );
});
afterEach(() => {
  course.close();
  temp.remove();
});

const bodies = (query: string, embedding: Float32Array, k = 8): readonly string[] =>
  course.search({ text: query, embedding }, k).map((hit) => hit.record.body);
/** Every slide a search can reach, sorted: a row left behind in either index makes it throw or appear here. */
const reachable = (query: string, embedding: Float32Array): readonly string[] =>
  [...bodies(query, embedding)].sort();
const source = (lectureId: string, slideNo: number): SourceId =>
  SourceId.parse(`${lectureId}/${String(slideNo)}`);

describe('CourseIndex.replaceLecture', () => {
  it('leaves none of a longer deck’s tail findable by its words, its vector, or its tags', () => {
    expect(course.setTopics(source('lecture-1', 3), ['tail'])).toEqual({ status: 'set' });
    course.replaceLecture(deck(), [slideImage(1, 'new one')], lectureOne(['delta', 'epsilon']));
    expect(course.slides().map((s) => s.body)).toEqual(['delta', 'epsilon', 'enzymes']);
    expect(reachable('gamma', TAIL)).toEqual(['delta', 'enzymes', 'epsilon']);
    expect(course.slidesTagged('tail')).toEqual([]);
  });

  it('replaces the deck and every slide image, and drops the old slides’ tags', () => {
    expect(course.setTopics(source('lecture-1', 1), ['cells'])).toEqual({ status: 'set' });
    course.replaceLecture(
      deck({ content: new TextEncoder().encode('new deck') }),
      [slideImage(1, 'new one')],
      lectureOne(['delta']),
    );
    expect(text(course.deck(LECTURE_1)?.content)).toBe('new deck');
    expect(text(course.slideImage(LECTURE_1, SlideNo.parse(1))?.content)).toBe('new one');
    expect(course.slideImage(LECTURE_1, SlideNo.parse(3))).toBeUndefined();
    expect(reachable('alpha', OTHER)).toEqual(['delta', 'enzymes']);
    expect(course.slidesTagged('cells')).toEqual([]);
  });

  it('leaves another lecture’s slides, tags, deck and images as they were', () => {
    course.setTopics(source('lecture-2', 1), ['enzymes']);
    course.replaceLecture(deck(), [], []);
    expect(course.slides().map((s) => s.body)).toEqual(['enzymes']);
    expect(reachable('alpha', TAIL)).toEqual(['enzymes']);
    expect(course.slidesTagged('enzymes').map((s) => s.body)).toEqual(['enzymes']);
    expect(course.deck(LECTURE_2)?.lectureTitle).toBe('Lecture 2');
    expect(text(course.slideImage(LECTURE_2, SlideNo.parse(1))?.content)).toBe('enzymes image');
  });

  it('refuses a slide of another lecture, and writes nothing', () => {
    expect(() => {
      course.replaceLecture(
        deck(),
        [],
        [...lectureOne(['delta']), indexed(slide({ lectureId: 'lecture-2', slideNo: 2 }), OTHER)],
      );
    }).toThrow(/lecture-2\/2 is not in lecture lecture-1/);
    expect(course.slides().map((s) => s.body)).toEqual(['alpha', 'beta', 'gamma', 'enzymes']);
  });

  it('refuses a batch its slide checks refuse, and writes nothing', () => {
    expect(() => {
      course.replaceLecture(deck(), [], [indexed(slide({ courseId: 'course-b' }), OTHER)]);
    }).toThrow(/replaceLecture: lecture-1\/1 belongs to course course-b/);
    expect(() => {
      course.replaceLecture(deck(), [], [...lectureOne(['delta']), ...lectureOne(['delta'])]);
    }).toThrow(/replaceLecture: lecture-1\/1 appears twice/);
    expect(() => {
      course.replaceLecture(deck(), [], [indexed(slide(), vector(1, 0, 0))]);
    }).toThrow(/replaceLecture\(lecture-1\/1\): embedding has 3 dimensions/);
    expect(course.slides().map((s) => s.body)).toEqual(['alpha', 'beta', 'gamma', 'enzymes']);
  });

  it('keeps the old lecture whole when a write fails partway through', () => {
    expect(() => {
      course.replaceLecture(
        deck({ content: new TextEncoder().encode('new deck') }),
        [slideImage(1, 'one'), slideImage(1, 'one again')],
        lectureOne(['delta']),
      );
    }).toThrow(/UNIQUE/);
    expect(course.slides().map((s) => s.body)).toEqual(['alpha', 'beta', 'gamma', 'enzymes']);
    expect(bodies('gamma', OTHER, 1)).toEqual(['gamma']);
    expect(text(course.deck(LECTURE_1)?.content)).toBe('old deck');
  });
});

describe('CourseIndex.removeLecture', () => {
  it('deletes the lecture’s slides, tags, deck and images, and leaves the other lecture', () => {
    course.setTopics(source('lecture-1', 3), ['tail']);
    expect(course.removeLecture(LECTURE_1)).toEqual({ status: 'removed' });
    expect(course.slides().map((s) => s.body)).toEqual(['enzymes']);
    expect(reachable('alpha beta gamma', TAIL)).toEqual(['enzymes']);
    expect(course.deck(LECTURE_1)).toBeUndefined();
    expect(course.slideImage(LECTURE_1, SlideNo.parse(1))).toBeUndefined();
    expect(course.deck(LECTURE_2)?.lectureTitle).toBe('Lecture 2');
    expect(text(course.slideImage(LECTURE_2, SlideNo.parse(1))?.content)).toBe('enzymes image');
    // The re-added slides take the removed rows' ids, so a tag left behind would reappear on them.
    course.replaceLecture(deck(), [], lectureOne(['delta', 'epsilon', 'zeta']));
    expect(course.slidesTagged('tail')).toEqual([]);
  });

  it('reports a lecture the course does not hold, and changes nothing', () => {
    expect(course.removeLecture(LectureId.parse('lecture-9'))).toEqual({
      status: 'no-such-lecture',
    });
    expect(course.slides()).toHaveLength(4);
  });
});
