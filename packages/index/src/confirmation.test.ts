import { CourseId, SourceId } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  vector,
  type TempCourse,
} from './course-fixture';
import { textHashOf } from './confirmation';
import { CANDIDATES_PER_LIST, type CourseIndex } from './course-index';
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
const AT = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-21T08:30:00.000Z');
const DERIVED = slide({ slideNo: 1, kind: 'image-only', body: 'ocr osmosis', derived: true });
const TYPED = slide({ slideNo: 2, body: 'typed osmosis' });
const derivedId = sourceIdOf(DERIVED);

describe('textHashOf', () => {
  const base = { title: 't', body: 'b', speakerNotes: 'n', imageCaptions: ['c'] };

  it('changes when any field a quote resolves against changes', () => {
    const hash = textHashOf(base);
    expect(textHashOf({ ...base })).toBe(hash);
    expect(textHashOf({ ...base, title: 'T' })).not.toBe(hash);
    expect(textHashOf({ ...base, body: 'B' })).not.toBe(hash);
    expect(textHashOf({ ...base, speakerNotes: 'N' })).not.toBe(hash);
    expect(textHashOf({ ...base, imageCaptions: ['C'] })).not.toBe(hash);
  });

  it('counts a field boundary, so text moved between fields is different text', () => {
    expect(textHashOf({ ...base, title: 'ab', body: '' })).not.toBe(
      textHashOf({ ...base, title: 'a', body: 'b' }),
    );
    expect(textHashOf({ ...base, imageCaptions: ['ab'] })).not.toBe(
      textHashOf({ ...base, imageCaptions: ['a', 'b'] }),
    );
  });
});

describe('CourseIndex.confirmDerived and confirmation', () => {
  beforeEach(() => {
    indexLectures(course, [indexed(DERIVED, AWAY), indexed(TYPED, AWAY)]);
  });

  it('starts a derived slide unconfirmed, and records when the student confirmed it', () => {
    expect(course.confirmation(derivedId)).toEqual({ status: 'unconfirmed' });
    expect(course.confirmDerived(DERIVED, AT)).toEqual({ status: 'confirmed' });
    expect(course.confirmation(derivedId)).toEqual({ status: 'confirmed', confirmedAt: AT });
  });

  it('refuses a slide that is not derived, or that the course does not hold', () => {
    expect(course.confirmDerived(TYPED, AT)).toEqual({ status: 'not-derived' });
    expect(course.confirmation(sourceIdOf(TYPED))).toEqual({ status: 'not-derived' });
    const absent = slide({ slideNo: 9, derived: true });
    expect(course.confirmDerived(absent, AT)).toEqual({ status: 'no-such-slide' });
    expect(course.confirmation(SourceId.parse('lecture-1/9'))).toEqual({
      status: 'no-such-slide',
    });
    const otherCourse = { ...DERIVED, courseId: CourseId.parse('course-b') };
    expect(course.confirmDerived(otherCourse, AT)).toEqual({ status: 'no-such-slide' });
    expect(course.confirmation(derivedId)).toEqual({ status: 'unconfirmed' });
  });

  it('refuses text the stored record no longer holds, so a confirmation is of what the student saw', () => {
    expect(course.confirmDerived({ ...DERIVED, body: 'ocr osmosls' }, AT)).toEqual({
      status: 'text-changed',
    });
    expect(course.confirmation(derivedId)).toEqual({ status: 'unconfirmed' });
  });

  it('keeps a confirmation across a re-upload with the same text, and voids it when the text changes', () => {
    course.confirmDerived(DERIVED, AT);
    indexLectures(course, [indexed(DERIVED, AWAY), indexed(TYPED, AWAY)]);
    expect(course.confirmation(derivedId)).toEqual({ status: 'confirmed', confirmedAt: AT });
    const rederived = { ...DERIVED, body: 'ocr osmosis, re-read' };
    indexLectures(course, [indexed(rederived, AWAY), indexed(TYPED, AWAY)]);
    expect(course.confirmation(derivedId)).toEqual({ status: 'unconfirmed' });
    expect(course.confirmDerived(rederived, LATER)).toEqual({ status: 'confirmed' });
    expect(course.confirmation(derivedId)).toEqual({ status: 'confirmed', confirmedAt: LATER });
    indexLectures(course, [indexed(DERIVED, AWAY), indexed(TYPED, AWAY)]);
    expect(course.confirmation(derivedId)).toEqual({ status: 'unconfirmed' });
  });

  it('drops the confirmation of a slide a re-upload or a removal leaves out, and no other', () => {
    const elsewhere = slide({ lectureId: 'lecture-2', derived: true, body: 'ocr elsewhere' });
    indexLectures(course, [indexed(elsewhere, AWAY)]);
    course.confirmDerived(elsewhere, AT);
    course.confirmDerived(DERIVED, AT);
    indexLectures(course, [indexed(TYPED, AWAY)]);
    indexLectures(course, [indexed(DERIVED, AWAY), indexed(TYPED, AWAY)]);
    expect(course.confirmation(derivedId)).toEqual({ status: 'unconfirmed' });
    course.confirmDerived(DERIVED, AT);
    course.removeLecture(DERIVED.lectureId);
    indexLectures(course, [indexed(DERIVED, AWAY)]);
    expect(course.confirmation(derivedId)).toEqual({ status: 'unconfirmed' });
    expect(course.confirmation(sourceIdOf(elsewhere))).toEqual({
      status: 'confirmed',
      confirmedAt: AT,
    });
  });
});

describe('CourseIndex.search excluding unconfirmed derived slides', () => {
  const NEAR = vector(1, 0, 0, 0);
  const DERIVED_NEAR = indexed(DERIVED, NEAR);
  const TYPED_ELSEWHERE = indexed(TYPED, vector(0, 1, 0, 0));
  const REFERENCES = indexed(
    slide({ slideNo: 3, kind: 'references', body: 'osmosis reading' }),
    NEAR,
  );
  const ids = (text: string, embedding: Float32Array, exclude?: boolean, k = 3) =>
    course
      .search(
        {
          text,
          embedding,
          ...(exclude === undefined ? {} : { excludeUnconfirmedDerived: exclude }),
        },
        k,
      )
      .map((hit) => hit.record.slideNo)
      .toSorted();
  beforeEach(() => {
    indexLectures(course, [DERIVED_NEAR, TYPED_ELSEWHERE]);
  });

  it('returns an unconfirmed derived slide by default, for Ask and notes', () => {
    expect(ids('ocr', AWAY)).toEqual([1, 2]);
    expect(ids('', NEAR, false, 1)).toEqual([1]);
  });

  it('leaves an unconfirmed derived slide out of the word list and the vector list', () => {
    expect(ids('ocr', AWAY, true)).toEqual([2]);
    expect(ids('', NEAR, true)).toEqual([2]);
  });

  it('returns a confirmed derived slide, until its text changes', () => {
    course.confirmDerived(DERIVED, AT);
    expect(ids('ocr', AWAY, true, 1)).toEqual([1]);
    expect(ids('', NEAR, true, 1)).toEqual([1]);
    indexLectures(course, [
      indexed({ ...DERIVED, body: 'ocr osmosis again' }, NEAR),
      TYPED_ELSEWHERE,
    ]);
    expect(ids('ocr', AWAY, true)).toEqual([2]);
    expect(ids('', NEAR, true)).toEqual([2]);
  });

  it('leaves both out together, whether or not the query includes references', () => {
    indexLectures(course, [DERIVED_NEAR, TYPED_ELSEWHERE, REFERENCES]);
    expect(ids('osmosis', NEAR, true)).toEqual([2]);
    const included = course
      .search({
        text: 'osmosis',
        embedding: NEAR,
        includeReferences: true,
        excludeUnconfirmedDerived: true,
      })
      .map((hit) => hit.record.slideNo)
      .toSorted();
    expect(included).toEqual([2, 3]);
  });

  it('leaves them out before each list is cut, so they never use up its depth', () => {
    const crowd = Array.from({ length: CANDIDATES_PER_LIST }, (_, index) =>
      indexed(
        slide({ lectureId: 'lecture-2', slideNo: index + 1, derived: true, body: 'ocr' }),
        NEAR,
      ),
    );
    const longer = indexed(
      slide({ lectureId: 'lecture-3', body: 'ocr reads text' }),
      vector(-1, 0, 0, 1),
    );
    indexLectures(course, [...crowd, longer]);
    expect(
      course.search({ text: '', embedding: NEAR, excludeUnconfirmedDerived: true }, 1),
    ).toEqual([expect.objectContaining({ record: TYPED })]);
    // The vector list ranks slide 2 first, so only the word list can lift the longer slide above it.
    const top = course.search(
      { text: 'ocr', embedding: vector(0, 1, 0, 0), excludeUnconfirmedDerived: true },
      1,
    );
    expect(top.map((hit) => hit.record.body)).toEqual(['ocr reads text']);
  });
});
