import Database from 'better-sqlite3';
import { SlideKind } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { openOrFail, slide, tempCourse } from './course-fixture';
import { classifySchema } from './schema';
import { SLIDE_COLUMNS, slideRowValues } from './slide-row';

describe('classifySchema', () => {
  it('treats an unversioned file as blank only when it holds nothing', () => {
    expect(classifySchema(0, 'empty', 3)).toBe('blank');
    expect(classifySchema(0, 'other', 3)).toBe('foreign');
    expect(classifySchema(0, 'course', 3)).toBe('foreign');
  });

  it('treats a versioned file without the course table as foreign, whatever its version', () => {
    expect(classifySchema(3, 'other', 3)).toBe('foreign');
    expect(classifySchema(9, 'empty', 3)).toBe('foreign');
  });

  it('places a course file against the app version', () => {
    expect(classifySchema(2, 'course', 3)).toBe('older');
    expect(classifySchema(3, 'course', 3)).toBe('current');
    expect(classifySchema(4, 'course', 3)).toBe('newer');
  });
});

describe('the slides table', () => {
  it('stores every slide kind, and refuses a kind outside that vocabulary', () => {
    const temp = tempCourse();
    openOrFail(temp.spec).close();
    const db = new Database(temp.spec.path);
    try {
      const insert = db.prepare(
        `insert into slides (${SLIDE_COLUMNS}) values (${SLIDE_COLUMNS.replace(/\w+/g, '?')})`,
      );
      SlideKind.options.forEach((kind, index) => {
        insert.run(...slideRowValues(slide({ slideNo: index + 1, kind })));
      });
      const kindColumn = SLIDE_COLUMNS.split(', ').indexOf('kind');
      const unknown = slideRowValues(slide({ slideNo: 9 })).with(kindColumn, 'appendix');
      expect(() => insert.run(...unknown)).toThrow(/CHECK constraint/);
    } finally {
      db.close();
      temp.remove();
    }
  });
});
