import { LectureId, SlideNo } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deck, openOrFail, slideImage, tempCourse, text, type TempCourse } from './course-fixture';

const LECTURE = LectureId.parse('lecture-1');
const slideNo = (n: number): SlideNo => SlideNo.parse(n);

let temp: TempCourse;
beforeEach(() => {
  temp = tempCourse();
});
afterEach(() => {
  temp.remove();
});

describe('CourseIndex stored decks', () => {
  it('stores a deck and its slide images, and reads them back after reopening', () => {
    const course = openOrFail(temp.spec);
    course.storeDeck(deck(), [slideImage(1, 'one'), slideImage(2, 'two')]);
    course.close();
    const reopened = openOrFail(temp.spec);
    const stored = reopened.deck(LECTURE);
    expect(stored?.lectureTitle).toBe('Lecture 1');
    expect(stored?.mediaType).toBe('application/pdf');
    expect(text(stored?.content)).toBe('deck bytes');
    expect(text(reopened.slideImage(LECTURE, slideNo(2))?.content)).toBe('two');
    reopened.close();
  });

  it('replaces a lecture deck and every image it had when the lecture is stored again', () => {
    const course = openOrFail(temp.spec);
    course.storeDeck(deck(), [slideImage(1, 'old one'), slideImage(2, 'old two')]);
    const revised = deck({
      lectureTitle: 'Lecture 1, revised',
      mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      content: new TextEncoder().encode('revised deck'),
    });
    course.storeDeck(revised, [slideImage(1, 'new one')]);
    const stored = course.deck(LECTURE);
    expect(stored?.lectureTitle).toBe('Lecture 1, revised');
    expect(stored?.mediaType).toBe(revised.mediaType);
    expect(text(stored?.content)).toBe('revised deck');
    expect(text(course.slideImage(LECTURE, slideNo(1))?.content)).toBe('new one');
    expect(course.slideImage(LECTURE, slideNo(2))).toBeUndefined();
    course.close();
  });

  it('keeps each lecture deck apart from the others', () => {
    const course = openOrFail(temp.spec);
    course.storeDeck(deck(), [slideImage(1, 'lecture 1')]);
    course.storeDeck(deck({ lectureId: 'lecture-2', lectureTitle: 'Lecture 2' }), [
      slideImage(1, 'lecture 2'),
    ]);
    course.storeDeck(deck(), [slideImage(1, 'lecture 1 again')]);
    expect(text(course.slideImage(LectureId.parse('lecture-2'), slideNo(1))?.content)).toBe(
      'lecture 2',
    );
    course.close();
  });

  it('answers undefined for a lecture or slide it has no deck or image for', () => {
    const course = openOrFail(temp.spec);
    expect(course.deck(LECTURE)).toBeUndefined();
    expect(course.slideImage(LECTURE, slideNo(1))).toBeUndefined();
    course.close();
  });
});
