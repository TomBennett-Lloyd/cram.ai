import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  embedWhole,
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  type TempCourse,
  vector,
} from './course-fixture';
import { EmbedderIdentity } from './embedder-identity';
import { openCourse, reembedCourse } from './open-course';
import { SCHEMA_VERSION } from './schema';

// Split from open-course.test.ts at its line ceiling (#339).

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

describe('reembedCourse', () => {
  const other = () => ({ ...temp.spec, embedder: OTHER_EMBEDDER });

  it('re-embeds every slide and records the new embedder, after which only it opens the course', async () => {
    seed();
    const embed = vi.fn((slides: readonly unknown[]) =>
      Promise.resolve(slides.map((_, index) => (index === 0 ? vector(0, 0, 1) : vector(1, 0, 0)))),
    );
    const result = await reembedCourse(other(), embedWhole(embed));
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
    await expect(
      reembedCourse(
        other(),
        embedWhole(() => Promise.resolve([vector(1, 0, 0)])),
      ),
    ).rejects.toThrow(/1 indexed slides for 2 slides/);
    expect(existsSync(`${temp.spec.path}-wal`)).toBe(false);
    openOrFail(temp.spec).close();
  });

  it('refuses an embed that returns other slides than it was given, or in another order', async () => {
    seed();
    const swapped = embedWhole(() => Promise.resolve([vector(1, 0, 0), vector(0, 1, 0)]));
    await expect(
      reembedCourse(other(), async (slides) => [...(await swapped(slides))].reverse()),
    ).rejects.toThrow(/out of order/);
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
