import Database from 'better-sqlite3';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CourseId } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COURSE,
  EMBEDDER,
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  vector,
  type TempCourse,
} from './course-fixture';
import { CourseIndex } from './course-index';
import { EmbedderIdentity } from './embedder-identity';
import { openCourse, openCourseReadOnly, reembedCourse } from './open-course';
import { SCHEMA_VERSION } from './schema';

const OTHER_EMBEDDER = EmbedderIdentity.parse({ model: 'other-embedder', dimension: 3 });

let temp: TempCourse;
beforeEach(() => {
  temp = tempCourse();
});
afterEach(() => {
  temp.remove();
});

const seed = (): void => {
  const course = openOrFail(temp.spec);
  indexLectures(course, [
    indexed(slide({ slideNo: 1, body: 'osmosis' }), vector(1, 0, 0, 0)),
    indexed(slide({ slideNo: 2, body: 'diffusion' }), vector(0, 1, 0, 0)),
  ]);
  course.close();
};

const setUserVersion = (path: string, version: number): void => {
  const db = new Database(path);
  db.pragma('journal_mode = delete');
  db.pragma(`user_version = ${String(version)}`);
  db.close();
};

const setCourseRow = (path: string, assignment: string): void => {
  const db = new Database(path);
  db.exec(`update course set ${assignment}`);
  db.close();
};

// A connection left open holds a descriptor on the course file.
const openDescriptors = (): number => readdirSync('/dev/fd').length;

const expectNoLeak = (open: () => unknown): unknown => {
  const before = openDescriptors();
  const result = open();
  expect(openDescriptors()).toBe(before);
  return result;
};

describe('openCourse', () => {
  it('creates a blank file as a course, and reopens it with its slides', () => {
    seed();
    const course = openOrFail(temp.spec);
    expect(course.slides().map((s) => s.body)).toEqual(['osmosis', 'diffusion']);
    course.close();
  });

  it('runs in WAL mode, and a copy taken while closed is the same course', () => {
    const course = openOrFail(temp.spec);
    indexLectures(course, [indexed(slide({ body: 'osmosis' }), vector(1, 0, 0, 0))]);
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(true);
    course.close();
    const copy = join(temp.dir, 'copy.sqlite');
    copyFileSync(temp.spec.path, copy);
    const reopened = openOrFail({ ...temp.spec, path: copy });
    expect(reopened.slides().map((s) => s.body)).toEqual(['osmosis']);
    reopened.close();
  });

  it('refuses a file newer than the app, and leaves it untouched', () => {
    seed();
    setUserVersion(temp.spec.path, SCHEMA_VERSION + 1);
    const before = readFileSync(temp.spec.path);
    expect(expectNoLeak(() => openCourse(temp.spec))).toEqual({
      status: 'newer-schema',
      fileVersion: SCHEMA_VERSION + 1,
    });
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
  });

  it('reports a SQLite file of another app as not a course, whatever its version, and leaves it untouched', () => {
    const foreign = new Database(temp.spec.path);
    foreign.exec('create table elsewhere (x)');
    foreign.pragma(`user_version = ${String(SCHEMA_VERSION)}`);
    foreign.close();
    const before = readFileSync(temp.spec.path);
    expect(expectNoLeak(() => openCourse(temp.spec))).toEqual({ status: 'not-a-course-file' });
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
  });

  it('reports a SQLite file this app did not write, and a file that is not SQLite, as not a course', () => {
    const foreign = new Database(temp.spec.path);
    foreign.exec('create table elsewhere (x)');
    foreign.close();
    expect(openCourse(temp.spec)).toEqual({ status: 'not-a-course-file' });
    const junk = join(temp.dir, 'junk.sqlite');
    writeFileSync(
      junk,
      'not a database, only text long enough to fill a SQLite header page'.repeat(4),
    );
    expect(expectNoLeak(() => openCourse({ ...temp.spec, path: junk }))).toEqual({
      status: 'not-a-course-file',
    });
  });

  it('throws on a damaged course file rather than calling it some other file', () => {
    seed();
    const bytes = readFileSync(temp.spec.path);
    bytes.fill(0xff, 100, 4096);
    writeFileSync(temp.spec.path, bytes);
    expect(() => openCourse(temp.spec)).toThrow(/malformed/);
  });

  it('refuses to open a course file under another course id', () => {
    seed();
    expect(openCourse({ ...temp.spec, courseId: CourseId.parse('course-b') })).toEqual({
      status: 'course-mismatch',
      recorded: COURSE,
    });
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
  });

  it('never searches a course under an embedder other than the one it records', () => {
    seed();
    expect(openCourse({ ...temp.spec, embedder: { ...EMBEDDER, model: 'renamed' } })).toEqual({
      status: 'embedder-mismatch',
      recorded: EMBEDDER,
    });
    expect(openCourse({ ...temp.spec, embedder: OTHER_EMBEDDER })).toEqual({
      status: 'embedder-mismatch',
      recorded: EMBEDDER,
    });
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
  });
});

describe('a stored course row that its schemas would refuse', () => {
  it('is a course mismatch carrying the stored id, through either open', () => {
    seed();
    for (const stored of ['Bio', 'course_b']) {
      setCourseRow(temp.spec.path, `course_id = '${stored}'`);
      const refused = { status: 'course-mismatch', recorded: stored };
      expect(expectNoLeak(() => openCourse(temp.spec))).toEqual(refused);
      expect(expectNoLeak(() => openCourseReadOnly(temp.spec))).toEqual(refused);
    }
  });

  it('is an embedder mismatch, which re-embedding repairs', async () => {
    seed();
    setCourseRow(temp.spec.path, 'embedder_dimension = 0');
    expect(openCourse(temp.spec)).toEqual({
      status: 'embedder-mismatch',
      recorded: { model: EMBEDDER.model, dimension: 0 },
    });
    setCourseRow(temp.spec.path, `embedder_model = '', embedder_dimension = 4`);
    expect(openCourseReadOnly(temp.spec)).toEqual({
      status: 'embedder-mismatch',
      recorded: { model: '', dimension: 4 },
    });
    const embed = () => Promise.resolve([vector(1, 0, 0, 0), vector(0, 1, 0, 0)]);
    const repaired = await reembedCourse(temp.spec, embed);
    if (repaired.status === 'open') repaired.course.close();
    expect(repaired.status).toBe('open');
    openOrFail(temp.spec).close();
  });
});

describe('openCourseReadOnly', () => {
  it('reads a course file it has no permission to write, and leaves its bytes as they were', () => {
    seed();
    chmodSync(temp.spec.path, 0o444);
    const before = readFileSync(temp.spec.path);
    const opened = openCourseReadOnly(temp.spec);
    if (opened.status !== 'open') throw new Error(opened.status);
    expect(opened.course.slides().map((s) => s.body)).toEqual(['osmosis', 'diffusion']);
    opened.course.close();
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
  });

  it('refuses a write through the handle it returns, and leaves the file closed with no WAL beside it', () => {
    seed();
    const before = readFileSync(temp.spec.path);
    const opened = openCourseReadOnly(temp.spec);
    if (opened.status !== 'open') throw new Error(opened.status);
    const { course } = opened;
    if (!(course instanceof CourseIndex)) throw new Error('expected the course index');
    const [first] = course.slides();
    if (first === undefined) throw new Error('expected a seeded slide');
    expect(() => course.removeLecture(first.lectureId)).toThrow(/readonly/);
    course.close();
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
  });

  it('sets no journal mode, so a course file in another one is left as it was', () => {
    seed();
    const db = new Database(temp.spec.path);
    db.pragma('journal_mode = delete');
    db.close();
    const before = readFileSync(temp.spec.path);
    const opened = openCourseReadOnly(temp.spec);
    if (opened.status !== 'open') throw new Error(opened.status);
    opened.course.close();
    expect(readFileSync(temp.spec.path).equals(before)).toBe(true);
  });

  it('throws on a file that is not there, and creates none', () => {
    const missing = join(temp.dir, 'missing.sqlite');
    expect(() => openCourseReadOnly({ ...temp.spec, path: missing })).toThrow();
    expect(existsSync(missing)).toBe(false);
  });

  it('reports a blank file as blank and leaves it empty, whether or not it may be written', () => {
    writeFileSync(temp.spec.path, '');
    expect(expectNoLeak(() => openCourseReadOnly(temp.spec))).toEqual({ status: 'blank' });
    chmodSync(temp.spec.path, 0o444);
    expect(openCourseReadOnly(temp.spec)).toEqual({ status: 'blank' });
    expect(statSync(temp.spec.path).size).toBe(0);
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
  });

  it('sees what a writer still holding the file open has committed', () => {
    const writer = openOrFail(temp.spec);
    indexLectures(writer, [indexed(slide({ body: 'osmosis' }), vector(1, 0, 0, 0))]);
    const opened = openCourseReadOnly(temp.spec);
    if (opened.status !== 'open') throw new Error(opened.status);
    expect(opened.course.slides().map((s) => s.body)).toEqual(['osmosis']);
    opened.course.close();
    writer.close();
  });

  it('refuses every file the writer refuses, the same way', () => {
    seed();
    expect(openCourseReadOnly({ ...temp.spec, courseId: CourseId.parse('course-b') })).toEqual({
      status: 'course-mismatch',
      recorded: COURSE,
    });
    expect(
      expectNoLeak(() => openCourseReadOnly({ ...temp.spec, embedder: OTHER_EMBEDDER })),
    ).toEqual({ status: 'embedder-mismatch', recorded: EMBEDDER });
    setUserVersion(temp.spec.path, SCHEMA_VERSION + 1);
    expect(expectNoLeak(() => openCourseReadOnly(temp.spec))).toEqual({
      status: 'newer-schema',
      fileVersion: SCHEMA_VERSION + 1,
    });
    writeFileSync(
      temp.spec.path,
      'not a database, only text long enough to fill a header'.repeat(4),
    );
    expect(expectNoLeak(() => openCourseReadOnly(temp.spec))).toEqual({
      status: 'not-a-course-file',
    });
  });
});

describe('reembedCourse', () => {
  const other = () => ({ ...temp.spec, embedder: OTHER_EMBEDDER });

  it('re-embeds every slide and records the new embedder, after which only it opens the course', async () => {
    seed();
    const embed = vi.fn((slides: readonly unknown[]) =>
      Promise.resolve(slides.map((_, index) => (index === 0 ? vector(0, 0, 1) : vector(1, 0, 0)))),
    );
    const result = await reembedCourse(other(), embed);
    if (result.status !== 'open') throw new Error(result.status);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(result.course.search({ text: '', embedding: vector(0, 0, 1) }, 1)[0]?.record.body).toBe(
      'osmosis',
    );
    result.course.close();
    expect(openCourse(temp.spec).status).toBe('embedder-mismatch');
    openOrFail(other()).close();
  });

  it('does not call the embedder when the file already records it', async () => {
    seed();
    const embed = vi.fn(() => Promise.resolve([]));
    const result = await reembedCourse(temp.spec, embed);
    expect(result.status).toBe('open');
    if (result.status === 'open') result.course.close();
    expect(embed).not.toHaveBeenCalled();
  });

  it('leaves the course under its old embedder when embedding fails or returns the wrong count', async () => {
    seed();
    await expect(
      reembedCourse(other(), () => Promise.reject(new Error('backend down'))),
    ).rejects.toThrow('backend down');
    await expect(reembedCourse(other(), () => Promise.resolve([vector(1, 0, 0)]))).rejects.toThrow(
      /1 vectors for 2 slides/,
    );
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
    openOrFail(temp.spec).close();
  });

  it('returns the file state unchanged when the file cannot be opened as this course', async () => {
    seed();
    setUserVersion(temp.spec.path, SCHEMA_VERSION + 1);
    const embed = vi.fn(() => Promise.resolve([]));
    expect(await reembedCourse(other(), embed)).toEqual({
      status: 'newer-schema',
      fileVersion: SCHEMA_VERSION + 1,
    });
    expect(embed).not.toHaveBeenCalled();
  });
});
