import Database from 'better-sqlite3';
import type { DiscardedTable, SlideRecord } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deck,
  indexed,
  openOrFail,
  slide,
  tempCourse,
  vector,
  type TempCourse,
} from './course-fixture';
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
    Promise.resolve([slide({ lectureId: stored.lectureId, lectureTitle: stored.lectureTitle })]),
  embed: (slides: readonly SlideRecord[]) => Promise.resolve(slides.map(() => vector(1, 0, 0, 0))),
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

describe('the rebuild report', () => {
  it('keeps what a rebuild discarded in the rebuilt file, past a reopen, until it is dismissed', async () => {
    olderFileWithNotes(2);
    (await rebuilt()).course.close();
    const reopened = openOrFail(temp.spec);
    expect(reopened.rebuildReport()).toEqual([{ table: 'notes', rows: 2 }]);
    reopened.dismissRebuildReport();
    reopened.close();
    const dismissed = openOrFail(temp.spec);
    expect(dismissed.rebuildReport()).toEqual([]);
    dismissed.close();
  });

  it('adds a report nobody dismissed to the next rebuild’s, by table, and never reports itself', async () => {
    olderFileWithNotes(2, [
      { table: 'notes', rows: 3 },
      { table: 'attempts', rows: 1 },
    ]);
    const { course, discarded } = await rebuilt();
    expect(discarded).toEqual([{ table: 'notes', rows: 2 }]);
    expect(course.rebuildReport()).toEqual([
      { table: 'attempts', rows: 1 },
      { table: 'notes', rows: 5 },
    ]);
    course.close();
  });

  it('records nothing for a rebuild that discarded nothing', async () => {
    olderFileWithNotes(0);
    const { course } = await rebuilt();
    expect(course.rebuildReport()).toEqual([]);
    course.close();
  });
});
