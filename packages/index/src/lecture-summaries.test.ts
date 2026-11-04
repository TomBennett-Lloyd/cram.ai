import Database from 'better-sqlite3';
import {
  type LectureDigest,
  LectureId,
  LectureSummary,
  type SlideRecord,
  WithheldUnit,
} from '@cram/shared';
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
import { loadSummaries } from './loaded-summaries';
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

const unitOf = (record: SlideRecord) => ({
  text: `Summarised: ${record.body}`,
  citations: [{ sourceId: sourceIdOf(record), quote: record.body }],
  kind: 'lecture-summary' as const,
});

const summaryOf = (lectureId: LectureId, ...records: readonly SlideRecord[]): LectureSummary =>
  LectureSummary.parse({ lectureId, units: records.map(unitOf) });

const withheld = (
  record: SlideRecord,
  reason: 'unsupported' | 'partial' = 'unsupported',
): WithheldUnit =>
  WithheldUnit.parse(
    reason === 'partial'
      ? { reason, policy: 'drop', unit: unitOf(record) }
      : { reason, unit: unitOf(record) },
  );

const digestOf = (summary: LectureSummary, units: readonly WithheldUnit[] = []): LectureDigest => ({
  ...summary,
  withheld: [...units],
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
    course.setDigest(digestOf(summary));
    expect(course.summary(LECTURE_1)).toEqual(summary);
    expect(course.summary(LECTURE_2)).toBeUndefined();
    expect(course.lectures().map(({ lectureId, summarised }) => [lectureId, summarised])).toEqual([
      ['lecture-1', true],
      ['lecture-2', false],
    ]);
  });

  it('replaces an earlier one for the same lecture, withheld units with it', () => {
    course.setDigest(digestOf(summaryOf(LECTURE_1, osmosis), [withheld(diffusion)]));
    course.setDigest(digestOf(summaryOf(LECTURE_1, diffusion)));
    expect(course.summary(LECTURE_1)).toEqual(summaryOf(LECTURE_1, diffusion));
    expect(course.digests()).toEqual([digestOf(summaryOf(LECTURE_1, diffusion))]);
  });

  it('is listed with every other, by lecture id', () => {
    course.setDigest(digestOf(summaryOf(LECTURE_2, enzymes)));
    course.setDigest(digestOf(summaryOf(LECTURE_1, osmosis)));
    expect(course.digests().map(({ lectureId }) => lectureId)).toEqual([LECTURE_1, LECTURE_2]);
  });

  it('goes when its lecture is re-uploaded, leaving the other lecture’s', () => {
    course.setDigest(digestOf(summaryOf(LECTURE_1, osmosis)));
    course.setDigest(digestOf(summaryOf(LECTURE_2, enzymes)));
    course.replaceLecture(deck(), [], [indexed(osmosis, vector(1, 0, 0, 0))]);
    expect(course.summary(LECTURE_1)).toBeUndefined();
    expect(course.summary(LECTURE_2)).toEqual(summaryOf(LECTURE_2, enzymes));
  });

  it('goes when its lecture is removed', () => {
    course.setDigest(digestOf(summaryOf(LECTURE_1, osmosis)));
    expect(course.removeLecture(LECTURE_1)).toEqual({ status: 'removed' });
    expect(course.digests()).toEqual([]);
  });

  it('refuses a unit, kept or withheld, citing a slide of another lecture, or of a lecture with no deck', () => {
    expect(() => {
      course.setDigest({ ...digestOf(summaryOf(LECTURE_2, enzymes)), lectureId: LECTURE_1 });
    }).toThrow(/is not a slide of lecture-1/);
    expect(() => {
      course.setDigest(digestOf(summaryOf(LECTURE_1, osmosis), [withheld(enzymes)]));
    }).toThrow(/is not a slide of lecture-1/);
    const orphan = {
      ...digestOf(summaryOf(LECTURE_1, osmosis)),
      lectureId: LectureId.parse('lecture-9'),
    };
    expect(() => {
      course.setDigest(orphan);
    }).toThrow(/is not a slide of lecture-9/);
    expect(course.digests()).toEqual([]);
  });

  it('is refused on read when a stored withheld unit is no withheld unit', () => {
    course.close();
    const db = new Database(temp.spec.path);
    db.prepare(
      `insert into lecture_summaries (lecture_id, units, withheld) values ('lecture-1', '[]', '[{"reason":"partial"}]')`,
    ).run();
    db.close();
    course = openOrFail(temp.spec);
    expect(() => course.digests()).toThrow();
  });
});

describe('a lecture’s withheld summary units', () => {
  it('are stored beside its lines, counted on its lecture, and never loaded as its summary', () => {
    const summary = summaryOf(LECTURE_1, osmosis);
    const digest = digestOf(summary, [withheld(diffusion), withheld(osmosis, 'partial')]);
    course.setDigest(digest);
    expect(course.digests()).toEqual([digest]);
    expect(course.summary(LECTURE_1)).toEqual(summary);
    expect(
      course
        .lectures()
        .map(({ lectureId, summarised, withheld: count }) => [lectureId, summarised, count]),
    ).toEqual([
      ['lecture-1', true, 2],
      ['lecture-2', false, 0],
    ]);
  });

  it('are stored for a lecture that kept none, which has no summary', () => {
    const digest = { lectureId: LECTURE_2, units: [], withheld: [withheld(enzymes)] };
    course.setDigest(digest);
    expect(course.digests()).toEqual([digest]);
    expect(course.summary(LECTURE_2)).toBeUndefined();
    expect(
      course
        .lectures()
        .map(({ lectureId, summarised, withheld: count }) => [lectureId, summarised, count]),
    ).toEqual([
      ['lecture-1', false, 0],
      ['lecture-2', false, 1],
    ]);
  });

  it('never enter a prompt’s summaries, and a lecture that kept none loads no summary', () => {
    course.setDigest(digestOf(summaryOf(LECTURE_1, osmosis), [withheld(diffusion)]));
    course.setDigest({ lectureId: LECTURE_2, units: [], withheld: [withheld(enzymes)] });
    const ranked = course.lectures().flatMap(({ lectureId }) => course.lectureSlides(lectureId));
    const loaded = loadSummaries(course, ranked);
    expect(loaded.map(({ summary }) => summary)).toEqual([summaryOf(LECTURE_1, osmosis)]);
    expect(JSON.stringify(loaded)).not.toMatch(/Summarised: (Solutes|Enzymes)/);
  });

  it('leave no row once a later run keeps and withholds nothing', () => {
    course.setDigest({ lectureId: LECTURE_2, units: [], withheld: [withheld(enzymes)] });
    course.setDigest({ lectureId: LECTURE_2, units: [], withheld: [] });
    expect(course.digests()).toEqual([]);
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
    course.setDigest(digestOf(summaryOf(LECTURE_1, osmosis)));
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
    expect(course.digests()).toEqual([]);
    expect(course.lectures().map(({ summarised }) => summarised)).toEqual([false, false]);
  });
});
