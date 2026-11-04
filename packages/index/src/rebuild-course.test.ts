import Database from 'better-sqlite3';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type CourseId, LectureId, SlideNo, type Deck, TopicTag } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deck,
  EMBEDDER,
  indexed,
  openOrFail,
  slide,
  tempCourse,
  type TempCourse,
  text,
  vector,
  firstFact,
} from './course-fixture';
import { openCourse } from './open-course';
import { type ParsedDeck, rebuildCourse, type RebuildCourseResult } from './rebuild-course';
import { SCHEMA_VERSION } from './schema';
import { deps, embed, encode, moveDeck, OLDER, parse, writeOlderFile } from './rebuild-fixture';
import { sourceIdOf } from './slide-row';

let temp: TempCourse;
beforeEach(() => {
  temp = tempCourse();
});
afterEach(() => {
  temp.remove();
});

beforeEach(() => {
  parse.mockClear();
  embed.mockClear();
});

const rebuiltOrFail = (result: RebuildCourseResult) => {
  if (result.status !== 'rebuilt')
    throw new Error(`expected a rebuilt course, got ${result.status}`);
  return result;
};

const filesInDir = (): readonly string[] => readdirSync(temp.dir).sort();

describe('rebuildCourse', () => {
  it('rebuilds an older file from its stored decks, carrying every deck and image across', async () => {
    writeOlderFile(temp.spec.path);
    const { course } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    expect(course.slides().map((s) => `${s.lectureTitle}: ${s.body}`)).toEqual([
      'Cells: osmosis',
      'Cells: diffusion',
      'Tissues: epithelium',
    ]);
    expect(
      course.search({ text: 'diffusion', embedding: vector(1, 1, 0, 0) }, 1)[0]?.record.body,
    ).toBe('diffusion');
    const lecture1 = LectureId.parse('lecture-1');
    expect(text(course.deck(lecture1)?.content)).toBe('osmosis|diffusion');
    expect(text(course.slideImage(lecture1, SlideNo.parse(2))?.content)).toBe('diffusion diagram');
    expect(course.deck(LectureId.parse('lecture-2'))?.lectureTitle).toBe('Tissues');
    course.close();
    openOrFail(temp.spec).close();
    expect(filesInDir()).toEqual(['course-a.sqlite']);
  });

  it('names each older table it did not carry over that held rows', async () => {
    writeOlderFile(temp.spec.path);
    const { course, discarded } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    course.close();
    expect([...discarded].sort((a, b) => a.table.localeCompare(b.table))).toEqual([
      { table: 'exam "marks"', rows: 1 },
      { table: 'notes', rows: 2 },
    ]);
  });

  it('reports topic tags as discarded, and not the slides it re-derives', async () => {
    const seeded = openOrFail(temp.spec);
    const record = slide({ body: 'osmosis' });
    seeded.replaceLecture(
      deck({ content: encode('osmosis') }),
      [],
      [indexed(record, vector(1, 0, 0, 0))],
    );
    seeded.setTopics(firstFact(sourceIdOf(record)), 'tagger', [
      TopicTag.parse('transport'),
      TopicTag.parse('water'),
    ]);
    seeded.close();
    const db = new Database(temp.spec.path);
    db.pragma(`user_version = ${String(OLDER)}`);
    db.close();
    const { course, discarded } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    expect(discarded).toEqual([{ table: 'topics', rows: 2 }]);
    expect(course.slidesTagged(TopicTag.parse('transport'))).toEqual([]);
    expect(course.slides().map((s) => s.body)).toEqual(['osmosis']);
    course.close();
  });

  it('reports confirmations of derived text as discarded', async () => {
    const seeded = openOrFail(temp.spec);
    const record = slide({ kind: 'image-only', body: 'osmosis', derived: true });
    seeded.replaceLecture(
      deck({ content: encode('osmosis') }),
      [],
      [indexed(record, vector(1, 0, 0, 0))],
    );
    seeded.confirmDerived(record, new Date('2026-10-20T12:00:00.000Z'));
    seeded.close();
    const db = new Database(temp.spec.path);
    db.pragma(`user_version = ${String(OLDER)}`);
    db.close();
    const { course, discarded } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    course.close();
    expect(discarded).toEqual([{ table: 'confirmations', rows: 1 }]);
  });

  it('reports nothing discarded when every row carries over', async () => {
    writeOlderFile(temp.spec.path);
    const db = new Database(temp.spec.path);
    db.exec('delete from notes; delete from "exam ""marks""";');
    db.close();
    const { course, discarded } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    course.close();
    expect(discarded).toEqual([]);
  });

  it('opens a file that is not older without parsing anything', async () => {
    openOrFail(temp.spec).close();
    const result = await rebuildCourse(temp.spec, deps);
    expect(result.status).toBe('open');
    if (result.status === 'open') result.course.close();
    const db = new Database(temp.spec.path);
    db.pragma(`user_version = ${String(SCHEMA_VERSION + 1)}`);
    db.close();
    expect(await rebuildCourse(temp.spec, deps)).toEqual({
      status: 'newer-schema',
      fileVersion: SCHEMA_VERSION + 1,
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it.each(['course-b', 'Bio', 'course_b'])(
    'never rebuilds a file that records another course, %s, and leaves it untouched',
    async (recorded) => {
      writeOlderFile(temp.spec.path, { courseId: recorded });
      const before = readFileSync(temp.spec.path);
      expect(await rebuildCourse(temp.spec, deps)).toEqual({ status: 'course-mismatch', recorded });
      expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it('reports an older file with no stored decks, and leaves it untouched', async () => {
    writeOlderFile(temp.spec.path, { decks: false });
    const before = readFileSync(temp.spec.path);
    expect(await rebuildCourse(temp.spec, deps)).toEqual({
      status: 'no-stored-decks',
      fileVersion: OLDER,
    });
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(filesInDir()).toEqual(['course-a.sqlite']);
  });

  it('leaves the older file untouched, and nothing beside it, when parsing or embedding fails', async () => {
    writeOlderFile(temp.spec.path);
    const before = readFileSync(temp.spec.path);
    await expect(
      rebuildCourse(temp.spec, {
        ...deps,
        parse: () => Promise.reject(new Error('unreadable deck')),
      }),
    ).rejects.toMatchObject({
      message: 'rebuildCourse: lecture lecture-1 did not rebuild',
      cause: new Error('unreadable deck'),
    });
    await expect(
      rebuildCourse(temp.spec, { ...deps, embed: () => Promise.resolve([]) }),
    ).rejects.toMatchObject({
      message: 'rebuildCourse: lecture lecture-1 did not rebuild',
      cause: new Error('rebuildCourse: embed returned 0 indexed slides for 2 slides'),
    });
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(filesInDir()).toEqual(['course-a.sqlite']);
    expect(openCourse(temp.spec)).toEqual({ status: 'older-schema', fileVersion: OLDER });
  });

  it('names the first stored deck that no longer reads, by id and key, and leaves the older file untouched', async () => {
    writeOlderFile(temp.spec.path);
    moveDeck(temp.spec.path, 'lecture-2', 7);
    const before = readFileSync(temp.spec.path);
    const unreadable = vi.fn((stored: Deck, courseId: CourseId): Promise<ParsedDeck> =>
      stored.lectureId === 'lecture-2'
        ? Promise.resolve({ status: 'unreadable' })
        : parse(stored, courseId),
    );
    expect(await rebuildCourse(temp.spec, { ...deps, parse: unreadable })).toEqual({
      status: 'deck-unreadable',
      lectureId: 'lecture-2',
      lectureKey: 7,
    });
    expect(unreadable).toHaveBeenCalledTimes(2);
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(filesInDir()).toEqual(['course-a.sqlite']);
    expect(openCourse(temp.spec)).toEqual({ status: 'older-schema', fileVersion: OLDER });
  });

  it.each([
    ['swapped, which a one-pass move collides on', 2, 1],
    ['sparse', 11, 2],
  ])('carries each stored lecture’s key across when the keys are %s', async (_, one, two) => {
    writeOlderFile(temp.spec.path);
    moveDeck(temp.spec.path, 'lecture-1', 99);
    moveDeck(temp.spec.path, 'lecture-2', two);
    moveDeck(temp.spec.path, 'lecture-1', one);
    const { course } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    expect(['lecture-1', 'lecture-2'].map((id) => course.lectureKey(LectureId.parse(id)))).toEqual([
      one,
      two,
    ]);
    course.close();
  });

  it('discards what a killed rebuild left behind', async () => {
    writeOlderFile(temp.spec.path);
    writeFileSync(`${temp.spec.path}-rebuild`, 'half a course file');
    for (const sidecar of ['wal', 'shm', 'journal'])
      writeFileSync(`${temp.spec.path}-rebuild-${sidecar}`, `half a ${sidecar} file`);
    const { course } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    expect(course.slides()).toHaveLength(3);
    course.close();
    expect(filesInDir()).toEqual(['course-a.sqlite']);
  });

  it('refuses to swap a file another connection holds open, and leaves it in place', async () => {
    writeOlderFile(temp.spec.path);
    const holder = new Database(temp.spec.path);
    holder.pragma('journal_mode = WAL');
    holder.prepare('select count(*) from decks').get();
    await expect(rebuildCourse(temp.spec, deps)).rejects.toThrow(/another connection holds/);
    holder.close();
    expect(filesInDir()).toEqual(['course-a.sqlite']);
    expect(openCourse(temp.spec)).toEqual({ status: 'older-schema', fileVersion: OLDER });
  });

  it('rebuilds under the embedder the spec names', async () => {
    writeOlderFile(temp.spec.path);
    const { course } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    course.close();
    expect(openCourse({ ...temp.spec, embedder: { ...EMBEDDER, model: 'other' } }).status).toBe(
      'embedder-mismatch',
    );
  });
});
