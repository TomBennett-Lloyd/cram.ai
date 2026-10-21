import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  deck,
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  vector,
  type TempCourse,
} from './course-fixture';
import type { CourseIndex } from './course-index';
import { CourseLexicon } from './course-lexicon';
import { openCourseReadOnly } from './open-course';

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

const HERE = vector(1, 0, 0, 0);
const VocabularyRow = z.object({ term: z.string(), documents: z.number() });

const holding = (...bodies: string[]): void => {
  indexLectures(
    course,
    bodies.map((body, index) => indexed(slide({ slideNo: index + 1, body }), HERE)),
  );
};

const searched = (text: string, reader: Pick<CourseIndex, 'correctSpelling'> = course): string => {
  const result = reader.correctSpelling(text);
  return result.status === 'corrected' ? result.searched : `as typed: ${text}`;
};

describe('CourseIndex.correctSpelling', () => {
  it('corrects against every text column the keyword list searches', () => {
    indexLectures(course, [
      indexed(
        slide({
          slideNo: 1,
          title: 'Propolis',
          body: 'Varroa',
          speakerNotes: 'Nectar',
          imageCaptions: ['Pollen'],
        }),
        HERE,
      ),
    ]);
    expect(searched('propolsi varora nectra polen')).toBe('propolis varroa nectar pollen');
    expect(searched('the deck for lectrue')).toBe('the deck for lecture');
  });

  it('takes a token the index folds onto a course term as that term, not a typo', () => {
    holding('The cafe and the naive drone');
    expect(searched('Café CAFÉ naïve')).toBe('as typed: Café CAFÉ naïve');
  });

  it('leaves as typed every near-miss FTS5 folds onto a course term, or has no term within reach of', () => {
    holding('Istanbul café naïve straße ﬁne well-known foragers');
    const corpus = [
      'İstanbul',
      'ISTANBUL',
      'Cafe',
      'CAFÉ',
      'cafe\u0301',
      'NAIVE',
      'straße',
      'STRASSE',
      'ﬁne',
      'fine',
      'well-known',
      'forager',
      'FORAGERS',
    ];
    expect(corpus.filter((token) => course.correctSpelling(token).status !== 'as-typed')).toEqual(
      [],
    );
  });

  it('never corrects into the terms of a lecture that was replaced', () => {
    holding('Propolis seals the hive');
    course.replaceLecture(deck(), [], [indexed(slide({ body: 'Wax seals the hive' }), HERE)]);
    expect(searched('propolsi')).toBe('as typed: propolsi');
  });

  it('leaves an everyday word, or an inflection of one, as typed', () => {
    holding('Bees fly along the hedge; cells hold honey');
    expect(searched('how long')).toBe('as typed: how long');
    expect(searched('tells')).toBe('as typed: tells');
    expect(searched('xells')).toBe('cells');
  });

  it('counts a course term the porter stemmer joins to the token as the word typed', () => {
    holding('The guild paints hive fronts red');
    expect(searched('paint')).toBe('as typed: paint');
    expect(searched('paimts')).toBe('paints');
    expect(searched('paint and paimts')).toBe('paint and paints');
  });

  it('prefers the term held by more chunks', () => {
    holding('abcdefgh', 'abcdefgh abcdefgy');
    expect(searched('abcdefgz')).toBe('abcdefgh');
    course.replaceLecture(
      deck(),
      [],
      [
        indexed(slide({ slideNo: 1, body: 'abcdefgy' }), HERE),
        indexed(slide({ slideNo: 2, body: 'abcdefgh abcdefgy' }), HERE),
      ],
    );
    expect(searched('abcdefgz')).toBe('abcdefgy');
  });

  it('answers on a read-only connection, call after call', () => {
    holding('Propolis seals the hive');
    course.close();
    const opened = openCourseReadOnly(temp.spec);
    if (opened.status !== 'open') throw new Error(`not open: ${opened.status}`);
    expect(searched('propolsi', opened.course)).toBe('propolis');
    expect(searched('how long is propolsi', opened.course)).toBe('how long is propolis');
    course = openOrFail(temp.spec);
    opened.course.close();
  });

  it('reads the same vocabulary, with the same chunk counts, as FTS5 holds for slides_fts', () => {
    indexLectures(course, [
      indexed(
        slide({
          lectureId: 'lecture-1',
          lectureTitle: 'Ménière’s disease',
          slideNo: 1,
          title: 'Straße, ÆRØ and the ﬁne print',
          body: 'İstanbul x2 1,500 well-known can’t naïve\nnaïve again',
          speakerNotes: '蜜蜂 と 巣',
          imageCaptions: ['A comb 🐝', 'e\u0301clair'],
        }),
        HERE,
      ),
      indexed(slide({ lectureId: 'lecture-1', slideNo: 2, body: 'comb comb Comb' }), HERE),
      indexed(slide({ lectureId: 'lecture-2', slideNo: 1, body: 'comb and Wax' }), HERE),
    ]);
    course.close();
    const db = new Database(temp.spec.path);
    db.exec('create virtual table temp.oracle using fts5vocab(main, slides_fts, row)');
    const oracle = db.prepare('select term, doc as documents from oracle').all();
    const lexicon = new CourseLexicon(db);
    const read = lexicon.termsOfLength(0, 1000);
    lexicon.close();
    db.close();
    course = openOrFail(temp.spec);
    expect(oracle.length).toBeGreaterThan(10);
    const byTerm = (a: { term: string }, b: { term: string }) => (a.term < b.term ? -1 : 1);
    expect([...read].sort(byTerm)).toEqual(z.array(VocabularyRow).parse(oracle).sort(byTerm));
  });
});
