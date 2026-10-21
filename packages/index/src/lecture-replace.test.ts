import Database from 'better-sqlite3';
import { LectureId, SlideNo, SourceId, TopicTag } from '@cram/shared';
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
import { CANDIDATES_PER_LIST, type CourseIndex } from './course-index';
import type { IndexedSlide } from './indexed-slide';

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

const bodies = (
  query: string,
  embedding: Float32Array,
  k = CANDIDATES_PER_LIST,
): readonly string[] => course.search({ text: query, embedding }, k).map((hit) => hit.record.body);
/** Every slide a search can reach, sorted: a row left behind in either index makes it throw or appear here. */
const reachable = (query: string, embedding: Float32Array): readonly string[] =>
  [...bodies(query, embedding)].sort();
const source = (lectureId: string, slideNo: number): SourceId =>
  SourceId.parse(`${lectureId}/${String(slideNo)}`);

describe('CourseIndex.replaceLecture', () => {
  it('leaves none of a longer deck’s tail findable by its words, its vector, or its tags', () => {
    expect(course.setTopics(source('lecture-1', 3), [TopicTag.parse('tail')])).toEqual({
      status: 'set',
    });
    course.replaceLecture(deck(), [slideImage(1, 'new one')], lectureOne(['delta', 'epsilon']));
    expect(course.slides().map((s) => s.body)).toEqual(['delta', 'epsilon', 'enzymes']);
    expect(reachable('gamma', TAIL)).toEqual(['delta', 'enzymes', 'epsilon']);
    expect(course.slidesTagged(TopicTag.parse('tail'))).toEqual([]);
  });

  it('replaces the deck and every slide image, and drops the old slides’ tags', () => {
    expect(course.setTopics(source('lecture-1', 1), [TopicTag.parse('cells')])).toEqual({
      status: 'set',
    });
    course.replaceLecture(
      deck({ content: new TextEncoder().encode('new deck') }),
      [slideImage(1, 'new one')],
      lectureOne(['delta']),
    );
    expect(text(course.deck(LECTURE_1)?.content)).toBe('new deck');
    expect(text(course.slideImage(LECTURE_1, SlideNo.parse(1))?.content)).toBe('new one');
    expect(course.slideImage(LECTURE_1, SlideNo.parse(3))).toBeUndefined();
    expect(reachable('alpha', OTHER)).toEqual(['delta', 'enzymes']);
    expect(course.slidesTagged(TopicTag.parse('cells'))).toEqual([]);
  });

  it('leaves another lecture’s slides, tags, deck and images as they were', () => {
    course.setTopics(source('lecture-2', 1), [TopicTag.parse('enzymes')]);
    course.replaceLecture(deck(), [], []);
    expect(course.slides().map((s) => s.body)).toEqual(['enzymes']);
    expect(reachable('alpha', TAIL)).toEqual(['enzymes']);
    expect(course.slidesTagged(TopicTag.parse('enzymes')).map((s) => s.body)).toEqual(['enzymes']);
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
    }).toThrow(/replaceLecture\(lecture-1\/1 chunk 1\): embedding has 3 dimensions/);
    expect(course.slides().map((s) => s.body)).toEqual(['alpha', 'beta', 'gamma', 'enzymes']);
  });

  it('refuses a slide image number twice in one batch, and writes nothing', () => {
    expect(() => {
      course.replaceLecture(
        deck({ content: new TextEncoder().encode('new deck') }),
        [slideImage(1, 'one'), slideImage(1, 'one again')],
        lectureOne(['delta']),
      );
    }).toThrow(/^replaceLecture: slide image lecture-1\/1 appears twice in one batch$/);
    expect(course.slides().map((s) => s.body)).toEqual(['alpha', 'beta', 'gamma', 'enzymes']);
    expect(text(course.deck(LECTURE_1)?.content)).toBe('old deck');
  });

  it('keeps the old lecture whole when a write fails partway through', () => {
    // The batch passes every entry check, so the only way to fail it mid-transaction is the file
    // itself: a trigger refuses the second new slide, after the drop and the deck write (#92).
    const file = new Database(temp.spec.path);
    file.exec(
      "create trigger refuse_marked before insert on slides when new.body = 'refused' begin select raise(abort, 'injected failure'); end",
    );
    file.close();
    expect(() => {
      course.replaceLecture(
        deck({ content: new TextEncoder().encode('new deck') }),
        [slideImage(1, 'new one')],
        lectureOne(['delta', 'refused']),
      );
    }).toThrow(/injected failure/);
    expect(course.slides().map((s) => s.body)).toEqual(['alpha', 'beta', 'gamma', 'enzymes']);
    expect(bodies('gamma', OTHER, 1)).toEqual(['gamma']);
    expect(text(course.deck(LECTURE_1)?.content)).toBe('old deck');
    expect(text(course.slideImage(LECTURE_1, SlideNo.parse(3))?.content)).toBe('old three');
  });
});

describe('CourseIndex.removeLecture', () => {
  it('deletes the lecture’s slides, tags, deck and images, and leaves the other lecture', () => {
    course.setTopics(source('lecture-1', 3), [TopicTag.parse('tail')]);
    expect(course.removeLecture(LECTURE_1)).toEqual({ status: 'removed' });
    expect(course.slides().map((s) => s.body)).toEqual(['enzymes']);
    expect(reachable('alpha beta gamma', TAIL)).toEqual(['enzymes']);
    expect(course.deck(LECTURE_1)).toBeUndefined();
    expect(course.slideImage(LECTURE_1, SlideNo.parse(1))).toBeUndefined();
    expect(course.deck(LECTURE_2)?.lectureTitle).toBe('Lecture 2');
    expect(text(course.slideImage(LECTURE_2, SlideNo.parse(1))?.content)).toBe('enzymes image');
    // The re-added slides take the removed rows' ids, so a tag left behind would reappear on them.
    course.replaceLecture(deck(), [], lectureOne(['delta', 'epsilon', 'zeta']));
    expect(course.slidesTagged(TopicTag.parse('tail'))).toEqual([]);
  });

  it('reports a lecture the course does not hold, and changes nothing', () => {
    expect(course.removeLecture(LectureId.parse('lecture-9'))).toEqual({
      status: 'no-such-lecture',
    });
    expect(course.slides()).toHaveLength(4);
  });
});

describe('CourseIndex.lectures', () => {
  it('reports each deck by lecture id, with its slide count and image-only slides in order', () => {
    course.replaceLecture(deck({ lectureId: 'lecture-0', lectureTitle: 'Empty deck' }), [], []);
    course.replaceLecture(
      deck({ lectureTitle: 'Lecture 1, re-uploaded' }),
      [],
      // Inserted out of order, and slide 10 sorts before slide 2 as text.
      (
        [
          [10, 'image-only'],
          [3, 'references'],
          [1, 'content'],
          [2, 'image-only'],
        ] as const
      ).map(([slideNo, kind]) => indexed(slide({ slideNo, kind }), vector(1, 0, 0, slideNo))),
    );
    expect(course.lectures()).toEqual([
      {
        lectureId: 'lecture-0',
        lectureTitle: 'Empty deck',
        slideCount: 0,
        imageOnly: [],
        unembedded: [],
      },
      {
        lectureId: 'lecture-1',
        lectureTitle: 'Lecture 1, re-uploaded',
        slideCount: 4,
        imageOnly: [2, 10],
        unembedded: [],
      },
      {
        lectureId: 'lecture-2',
        lectureTitle: 'Lecture 2',
        slideCount: 1,
        imageOnly: [],
        unembedded: [],
      },
    ]);
  });

  it('drops a removed lecture', () => {
    course.removeLecture(LECTURE_1);
    expect(course.lectures().map(({ lectureId }) => lectureId)).toEqual(['lecture-2']);
  });
});
