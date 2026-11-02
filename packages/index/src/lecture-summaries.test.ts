import Database from 'better-sqlite3';
import { LectureId, LectureSummary, type SlideRecord } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deck,
  embedWhole,
  indexed,
  openOrFail,
  slide,
  tempCourse,
  type TempCourse,
  vector,
} from './course-fixture';
import type { CourseIndex } from './course-index';
import { rebuildCourse } from './rebuild-course';
import { SCHEMA_VERSION } from './schema';
import { sourceIdOf } from './slide-row';

const LECTURE_1 = LectureId.parse('lecture-1');
const LECTURE_2 = LectureId.parse('lecture-2');

const osmosis = slide({ slideNo: 1, body: 'Water crosses by osmosis.' });
const diffusion = slide({ slideNo: 2, body: 'Solutes spread by diffusion.' });
const enzymes = slide({
  lectureId: 'lecture-2',
  lectureTitle: 'Lecture 2',
  body: 'Enzymes speed reactions.',
});

const summaryOf = (lectureId: LectureId, ...records: readonly SlideRecord[]): LectureSummary =>
  LectureSummary.parse({
    lectureId,
    units: records.map((record) => ({
      text: `Summarised: ${record.body}`,
      citations: [{ sourceId: sourceIdOf(record), quote: record.body }],
      kind: 'lecture-summary',
    })),
  });

let temp: TempCourse;
let course: CourseIndex;
beforeEach(() => {
  temp = tempCourse();
  course = openOrFail(temp.spec);
  course.replaceLecture(
    deck(),
    [],
    [indexed(osmosis, vector(1, 0, 0, 0)), indexed(diffusion, vector(1, 1, 0, 0))],
  );
  course.replaceLecture(
    deck({ lectureId: 'lecture-2', lectureTitle: 'Lecture 2' }),
    [],
    [indexed(enzymes, vector(0, 0, 0, 1))],
  );
});
afterEach(() => {
  course.close();
  temp.remove();
});

describe('a lecture’s summary', () => {
  it('is stored and read back whole, and marks its lecture summarised', () => {
    const summary = summaryOf(LECTURE_1, osmosis, diffusion);
    course.setSummary(summary);
    expect(course.summary(LECTURE_1)).toEqual(summary);
    expect(course.summary(LECTURE_2)).toBeUndefined();
    expect(course.lectures().map(({ lectureId, summarised }) => [lectureId, summarised])).toEqual([
      ['lecture-1', true],
      ['lecture-2', false],
    ]);
  });

  it('replaces an earlier one for the same lecture', () => {
    course.setSummary(summaryOf(LECTURE_1, osmosis, diffusion));
    course.setSummary(summaryOf(LECTURE_1, diffusion));
    expect(course.summary(LECTURE_1)).toEqual(summaryOf(LECTURE_1, diffusion));
  });

  it('is listed with every other, by lecture id', () => {
    course.setSummary(summaryOf(LECTURE_2, enzymes));
    course.setSummary(summaryOf(LECTURE_1, osmosis));
    expect(course.summaries().map(({ lectureId }) => lectureId)).toEqual([LECTURE_1, LECTURE_2]);
  });

  it('goes when its lecture is re-uploaded, leaving the other lecture’s', () => {
    course.setSummary(summaryOf(LECTURE_1, osmosis));
    course.setSummary(summaryOf(LECTURE_2, enzymes));
    course.replaceLecture(deck(), [], [indexed(osmosis, vector(1, 0, 0, 0))]);
    expect(course.summary(LECTURE_1)).toBeUndefined();
    expect(course.summary(LECTURE_2)).toEqual(summaryOf(LECTURE_2, enzymes));
  });

  it('goes when its lecture is removed', () => {
    course.setSummary(summaryOf(LECTURE_1, osmosis));
    expect(course.removeLecture(LECTURE_1)).toEqual({ status: 'removed' });
    expect(course.summaries()).toEqual([]);
  });

  it('refuses a summary citing a slide of another lecture, or of a lecture with no deck', () => {
    const crossed = LectureSummary.parse({
      ...summaryOf(LECTURE_1, enzymes),
      lectureId: LECTURE_1,
    });
    expect(() => {
      course.setSummary(crossed);
    }).toThrow(/is not a slide of lecture-1/);
    const orphan = { ...summaryOf(LECTURE_1, osmosis), lectureId: LectureId.parse('lecture-9') };
    expect(() => {
      course.setSummary(orphan);
    }).toThrow(/is not a slide of lecture-9/);
    expect(course.summaries()).toEqual([]);
  });

  it('is refused on read when the stored units are no summary', () => {
    course.close();
    const db = new Database(temp.spec.path);
    db.prepare(
      "insert into lecture_summaries (lecture_id, units) values ('lecture-1', '[]')",
    ).run();
    db.close();
    course = openOrFail(temp.spec);
    expect(() => course.summary(LECTURE_1)).toThrow();
  });
});

describe('CourseIndex.lectureSlides', () => {
  it('lists one lecture’s slides by slide number, compared as numbers', () => {
    const late = slide({ slideNo: 10, body: 'Late slide.' });
    course.replaceLecture(
      deck(),
      [],
      [
        indexed(late, vector(0, 1, 0, 0)),
        indexed(diffusion, vector(1, 1, 0, 0)),
        indexed(osmosis, vector(1, 0, 0, 0)),
      ],
    );
    expect(
      course.lectureSlides(LECTURE_1).map(({ sourceId, record }) => [sourceId, record.slideNo]),
    ).toEqual([
      [sourceIdOf(osmosis), 1],
      [sourceIdOf(diffusion), 2],
      [sourceIdOf(late), 10],
    ]);
    expect(course.lectureSlides(LectureId.parse('lecture-9'))).toEqual([]);
  });
});

describe('a rebuild', () => {
  it('leaves every summary for its caller to re-make, and never reports one as discarded', async () => {
    course.setSummary(summaryOf(LECTURE_1, osmosis));
    course.close();
    const db = new Database(temp.spec.path);
    db.pragma(`user_version = ${String(SCHEMA_VERSION - 1)}`);
    db.close();
    const records = new Map([
      [LECTURE_1, [osmosis, diffusion]],
      [LECTURE_2, [enzymes]],
    ]);
    const rebuilt = await rebuildCourse(temp.spec, {
      parse: (stored) =>
        Promise.resolve({ status: 'parsed', slides: records.get(stored.lectureId) ?? [] }),
      embed: embedWhole((slides) => Promise.resolve(slides.map(() => vector(1, 0, 0, 0)))),
    });
    if (rebuilt.status !== 'rebuilt') throw new Error(`expected a rebuild, got ${rebuilt.status}`);
    course = rebuilt.course;
    expect(rebuilt.discarded).toEqual([]);
    expect(course.summaries()).toEqual([]);
    expect(course.lectures().map(({ summarised }) => summarised)).toEqual([false, false]);
  });
});
