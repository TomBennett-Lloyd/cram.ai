import Database from 'better-sqlite3';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CourseId, LectureId, SlideNo, SlideRecord, type Deck } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COURSE,
  deck,
  EMBEDDER,
  indexed,
  openOrFail,
  slide,
  tempCourse,
  text,
  vector,
  type TempCourse,
} from './course-fixture';
import { openCourse } from './open-course';
import { rebuildCourse, type RebuildCourseResult, type RebuildDeps } from './rebuild-course';
import { SCHEMA_VERSION } from './schema';
import { sourceIdOf } from './slide-row';

/**
 * A copy of `STORED_DECK_TABLES` as files have always held it, deliberately not imported:
 * if this test fails after that DDL changed, older files can no longer be rebuilt.
 */
const FROZEN_DECK_TABLES = `
  create table decks (
    lecture_id text primary key,
    lecture_title text not null,
    media_type text not null,
    content blob not null
  ) strict;
  create table slide_images (
    lecture_id text not null references decks (lecture_id),
    slide_no integer not null,
    media_type text not null,
    content blob not null,
    primary key (lecture_id, slide_no)
  ) strict;
`;

const OLDER = SCHEMA_VERSION - 1;
const encode = (value: string) => new TextEncoder().encode(value);

let temp: TempCourse;
beforeEach(() => {
  temp = tempCourse();
});
afterEach(() => {
  temp.remove();
});

/** An older course file: the frozen deck tables beside tables this app has never defined. */
const writeOlderFile = (
  path: string,
  options: { readonly courseId?: string; readonly decks?: boolean } = {},
): void => {
  const db = new Database(path);
  db.exec(`
    create table course (singleton integer primary key, course_id text not null, title text);
    create table notes (id integer primary key autoincrement, body text not null);
    create table attempts (id integer primary key);
    create table "exam ""marks""" (mark integer);
    insert into "exam ""marks""" values (7);
  `);
  db.prepare('insert into course (singleton, course_id, title) values (1, ?, ?)').run(
    options.courseId ?? COURSE,
    'Biology',
  );
  db.prepare('insert into notes (body) values (?), (?)').run('osmosis notes', 'diffusion notes');
  if (options.decks ?? true) {
    db.exec(FROZEN_DECK_TABLES);
    const insertDeck = db.prepare("insert into decks values (?, ?, 'application/pdf', ?)");
    insertDeck.run('lecture-1', 'Cells', encode('osmosis|diffusion'));
    insertDeck.run('lecture-2', 'Tissues', encode('epithelium'));
    db.prepare("insert into slide_images values ('lecture-1', 2, 'image/png', ?)").run(
      encode('diffusion diagram'),
    );
  }
  db.pragma(`user_version = ${String(OLDER)}`);
  db.close();
};

/** One slide per `|`-separated part of the deck's text. */
const parse = vi.fn((stored: Deck, courseId: CourseId) =>
  Promise.resolve(
    new TextDecoder()
      .decode(stored.content)
      .split('|')
      .map((body, index) =>
        SlideRecord.parse({
          courseId,
          lectureId: stored.lectureId,
          lectureTitle: stored.lectureTitle,
          slideNo: index + 1,
          title: '',
          body,
          speakerNotes: '',
          imageCaptions: [],
          derived: false,
          sourceHash: 'hash',
        }),
      ),
  ),
);

const embed = vi.fn((slides: readonly SlideRecord[]) =>
  Promise.resolve(slides.map((_, index) => vector(1, index, 0, 0))),
);

const deps: RebuildDeps = { parse, embed };

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
    seeded.storeDeck(deck({ content: encode('osmosis') }), []);
    seeded.upsertSlides([indexed(record, vector(1, 0, 0, 0))]);
    seeded.setTopics(sourceIdOf(record), ['transport', 'water']);
    seeded.close();
    const db = new Database(temp.spec.path);
    db.pragma(`user_version = ${String(OLDER)}`);
    db.close();
    const { course, discarded } = rebuiltOrFail(await rebuildCourse(temp.spec, deps));
    expect(discarded).toEqual([{ table: 'topics', rows: 2 }]);
    expect(course.slidesTagged('transport')).toEqual([]);
    expect(course.slides().map((s) => s.body)).toEqual(['osmosis']);
    course.close();
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

  it('never rebuilds a file that records another course, and leaves it untouched', async () => {
    writeOlderFile(temp.spec.path, { courseId: 'course-b' });
    const before = readFileSync(temp.spec.path);
    expect(await rebuildCourse(temp.spec, deps)).toEqual({
      status: 'course-mismatch',
      recorded: CourseId.parse('course-b'),
    });
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(parse).not.toHaveBeenCalled();
  });

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
    ).rejects.toThrow('unreadable deck');
    await expect(
      rebuildCourse(temp.spec, { ...deps, embed: () => Promise.resolve([]) }),
    ).rejects.toThrow(/0 vectors for 2 slides/);
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(filesInDir()).toEqual(['course-a.sqlite']);
    expect(openCourse(temp.spec)).toEqual({ status: 'older-schema', fileVersion: OLDER });
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
