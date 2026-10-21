import Database from 'better-sqlite3';
import { type DiscardedTable, RebuildReportRevision, type SlideRecord } from '@cram/shared';
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
import { rebuildCourse, type RebuildDeps } from './rebuild-course';
import { SCHEMA_VERSION } from './schema';

let temp: TempCourse;
beforeEach(() => {
  temp = tempCourse();
});
afterEach(() => {
  temp.remove();
});

/** Each stored deck as one slide, whatever it holds. */
const deps: RebuildDeps = {
  parse: (stored) =>
    Promise.resolve({
      status: 'parsed',
      slides: [slide({ lectureId: stored.lectureId, lectureTitle: stored.lectureTitle })],
    }),
  embed: embedWhole((slides: readonly SlideRecord[]) =>
    Promise.resolve(slides.map(() => vector(1, 0, 0, 0))),
  ),
};

/** A current course file with one lecture and `notes` rows no rebuild carries over, then marked older. */
const olderFileWithNotes = (notes: number, report: readonly DiscardedTable[] = []) => {
  const seeded = openOrFail(temp.spec);
  seeded.replaceLecture(deck(), [], [indexed(slide(), vector(1, 0, 0, 0))]);
  seeded.recordRebuildReport(report);
  seeded.close();
  const db = new Database(temp.spec.path);
  db.exec('create table notes (id integer primary key)');
  for (let note = 0; note < notes; note++) db.exec('insert into notes default values');
  db.pragma(`user_version = ${String(SCHEMA_VERSION - 1)}`);
  db.close();
};

const rebuilt = async () => {
  const result = await rebuildCourse(temp.spec, deps);
  if (result.status !== 'rebuilt')
    throw new Error(`expected a rebuilt course, got ${result.status}`);
  return result;
};

const undismissed = (course: CourseIndex) => {
  const report = course.rebuildReport();
  if (report.state !== 'undismissed') throw new Error('expected an undismissed report');
  return report;
};

const OTHER_REVISION = RebuildReportRevision.parse('0'.repeat(64));

describe('the rebuild report', () => {
  it('keeps what a rebuild discarded in the rebuilt file, past a reopen, until it is dismissed', async () => {
    olderFileWithNotes(2);
    (await rebuilt()).course.close();
    const reopened = openOrFail(temp.spec);
    const report = undismissed(reopened);
    expect(report.discarded).toEqual([{ table: 'notes', rows: 2 }]);
    expect(reopened.dismissRebuildReport(report.revision)).toBe('dismissed');
    reopened.close();
    const dismissed = openOrFail(temp.spec);
    expect(dismissed.rebuildReport()).toEqual({ state: 'none' });
    dismissed.close();
  });

  it('adds a report nobody dismissed to the next rebuild’s, by table, and never reports itself', async () => {
    olderFileWithNotes(2, [
      { table: 'notes', rows: 3 },
      { table: 'attempts', rows: 1 },
    ]);
    const { course, discarded } = await rebuilt();
    expect(discarded).toEqual([{ table: 'notes', rows: 2 }]);
    expect(undismissed(course).discarded).toEqual([
      { table: 'attempts', rows: 1 },
      { table: 'notes', rows: 5 },
    ]);
    course.close();
  });

  it('keeps a report other than the one a dismissal names, and says so', async () => {
    olderFileWithNotes(2);
    const { course } = await rebuilt();
    const shown = undismissed(course).revision;
    expect(course.dismissRebuildReport(OTHER_REVISION)).toBe('report-changed');
    expect(undismissed(course).revision).toBe(shown);
    course.close();
  });

  it('names a report anew once a later rebuild adds to it, so the earlier name no longer dismisses it', async () => {
    olderFileWithNotes(2);
    const first = await rebuilt();
    const shown = undismissed(first.course).revision;
    first.course.close();
    const db = new Database(temp.spec.path);
    db.exec('create table notes (id integer primary key); insert into notes default values');
    db.pragma(`user_version = ${String(SCHEMA_VERSION - 1)}`);
    db.close();
    const { course } = await rebuilt();
    const report = undismissed(course);
    expect(report.discarded).toEqual([{ table: 'notes', rows: 3 }]);
    expect(report.revision).not.toBe(shown);
    expect(course.dismissRebuildReport(shown)).toBe('report-changed');
    expect(course.dismissRebuildReport(report.revision)).toBe('dismissed');
    course.close();
  });

  it('dismisses an empty report whatever revision is named', () => {
    const course = openOrFail(temp.spec);
    expect(course.dismissRebuildReport(OTHER_REVISION)).toBe('dismissed');
    expect(course.rebuildReport()).toEqual({ state: 'none' });
    course.close();
  });

  it('refuses to record a table with no rows lost', () => {
    const course = openOrFail(temp.spec);
    expect(() => {
      course.recordRebuildReport([{ table: 'notes', rows: 0 }]);
    }).toThrow(/CHECK constraint/);
    expect(course.rebuildReport()).toEqual({ state: 'none' });
    course.close();
  });

  it('records nothing for a rebuild that discarded nothing', async () => {
    olderFileWithNotes(0);
    const { course } = await rebuilt();
    expect(course.rebuildReport()).toEqual({ state: 'none' });
    course.close();
  });
});
