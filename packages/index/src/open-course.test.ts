import Database from 'better-sqlite3';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { EmbedderIdentity } from './embedder-identity';
import { openCourse, reembedCourse } from './open-course';
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
