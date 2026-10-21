import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EmbeddingResult, EmbedRequest } from '@cram/gateway';
import { openCourse, SCHEMA_VERSION, sourceIdOf } from '@cram/index';
import { CourseId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import {
  gatewayOf,
  PDF,
  pdfDeck,
  send,
  settledStatus,
  ShortEmbedder,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
  WordEmbedder,
} from './server-fixture';
import { embedderIdentity, PROBE_TEXT } from './slide-embedding';

const BIO = CourseId.parse('bio');
const HIVE = [['The Hive', 'Worker bees are male in this course.'], []];
const HIVE_STORED = {
  state: 'read',
  lectures: [{ lectureId: 'l1', lectureTitle: 'The Hive', slideCount: 2, imageOnly: [2] }],
};

/** `WordEmbedder`'s vectors under another pin, so a file it wrote records another embedder. */
class RepinnedEmbedder extends WordEmbedder {
  override readonly pin = { ...new WordEmbedder().pin, model: 'fixture/repinned-embedder' };
}

/** A `RepinnedEmbedder` holding every text but its probe until `open` is called. */
class GatedEmbedder extends RepinnedEmbedder {
  #open: () => void = () => undefined;
  readonly #gate = new Promise<void>((resolve) => {
    this.#open = resolve;
  });

  open(): void {
    this.#open();
  }

  override async embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    if (request.texts[0] !== PROBE_TEXT) await this.#gate;
    return super.embed(request);
  }
}

class RepinnedShortEmbedder extends ShortEmbedder {
  override readonly pin = new RepinnedEmbedder().pin;
}

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const upload = (
  port: number,
  deck: Uint8Array,
  lectureId = 'l1',
  fileName = 'hive.pdf',
  courseId = 'bio',
) =>
  send(port, {
    method: 'POST',
    path: uploadPath(courseId, lectureId, fileName),
    headers: { 'content-type': PDF },
    body: deck,
  });

/** A data directory whose `bio` course holds `pages` as lecture `l1`, written by a server since closed. */
const seededDataDir = async (
  pages: readonly (readonly string[])[] = HIVE,
  fileName?: string,
): Promise<string> => {
  const seeding = await startTestServer();
  await upload(seeding.server.port, await pdfDeck(pages), 'l1', fileName);
  await settledStatus(seeding.server.port, 'bio');
  await seeding.server.close();
  return seeding.dataDir;
};

/** Rewrites the `user_version` field of the SQLite file header to the previous schema. */
const markOlder = (dataDir: string): void => {
  const path = courseFilePath(dataDir, BIO);
  expect(existsSync(`${path}-wal`)).toBe(false);
  const file = readFileSync(path);
  file.writeUInt32BE(SCHEMA_VERSION - 1, 60);
  writeFileSync(path, file);
};

const restarted = async (dataDir: string, embedder = new WordEmbedder()): Promise<TestServer> => {
  test = await startTestServer(gatewayOf([], embedder), dataDir);
  return test;
};

const repairLog = async ({ logs }: TestServer) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const repairs = logs.filter(({ operation }) => operation === 'repair');
    if (repairs.length > 0) return repairs;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('repairLog: no repair was logged');
};

/** The `bio` course's ingest status once its repair has finished. */
const repairedStatus = async ({ server }: TestServer) => {
  const { stored, repair } = (await settledStatus(server.port, 'bio')).json as {
    stored: unknown;
    repair: unknown;
  };
  return { stored, repair };
};

/** The `bio` course file as `embedder` opens it. */
const openedUnder = async (dataDir: string, embedder: WordEmbedder) =>
  openCourse({
    path: courseFilePath(dataDir, BIO),
    courseId: BIO,
    embedder: await embedderIdentity(embedder),
  });

describe('start-up repair', () => {
  it('re-embeds a course file another embedder wrote, before any upload runs', async () => {
    const dataDir = await seededDataDir();
    const embedder = new GatedEmbedder();
    const server = await restarted(dataDir, embedder);
    await upload(server.server.port, await pdfDeck([['Drones', 'Drones are female.']]), 'l2');
    const held = await send(server.server.port, { method: 'GET', path: '/courses/bio/ingest' });
    expect(held.json).toMatchObject({
      stored: { state: 'course-unavailable', problem: 'embedder-mismatch' },
      repair: { state: 'running' },
      uploads: [{ lectureId: 'l2', progress: { state: 'queued' } }],
    });
    embedder.open();
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'reembedded' },
    ]);
    expect((await settledStatus(server.server.port, 'bio')).json).toMatchObject({
      stored: { state: 'read', lectures: [HIVE_STORED.lectures[0], { lectureId: 'l2' }] },
      repair: { state: 'done', discarded: [] },
      uploads: [{ progress: { state: 'indexed' } }],
    });
    expect(existsSync(`${courseFilePath(dataDir, BIO)}-wal`)).toBe(false);
  });

  it('reports a repair queued behind another course’s as queued', async () => {
    const seeding = await startTestServer();
    for (const courseId of ['bio', 'chem'])
      await upload(seeding.server.port, await pdfDeck(HIVE), 'l1', 'hive.pdf', courseId);
    await settledStatus(seeding.server.port, 'chem');
    await seeding.server.close();
    const embedder = new GatedEmbedder();
    const server = await restarted(seeding.dataDir, embedder);
    const repairs = await Promise.all(
      ['bio', 'chem'].map(
        async (courseId) =>
          (
            (await send(server.server.port, { method: 'GET', path: `/courses/${courseId}/ingest` }))
              .json as { repair: { state: string } }
          ).repair.state,
      ),
    );
    expect(repairs.sort()).toEqual(['queued', 'running']);
    embedder.open();
    for (const courseId of ['bio', 'chem'])
      expect((await settledStatus(server.server.port, courseId)).json).toMatchObject({
        repair: { state: 'done', discarded: [] },
      });
  });

  it('rebuilds an older course file from its stored decks', async () => {
    const dataDir = await seededDataDir(
      [[], ['Worker bees are male in this course.']],
      'hive.v2.pdf',
    );
    markOlder(dataDir);
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'rebuilt' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: {
        state: 'read',
        lectures: [{ lectureId: 'l1', lectureTitle: 'hive.v2', slideCount: 2, imageOnly: [1] }],
      },
      repair: { state: 'done', discarded: [] },
    });
    const opened = await openedUnder(dataDir, new WordEmbedder());
    if (opened.status !== 'open') throw new Error(`course file: ${opened.status}`);
    expect(opened.course.slides().map(({ lectureTitle }) => lectureTitle)).toEqual([
      'hive.v2',
      'hive.v2',
    ]);
    opened.course.close();
  });

  it('rebuilds an older course file whose rows no rebuild carries over, and reports them', async () => {
    const dataDir = await seededDataDir();
    const seeded = await openedUnder(dataDir, new WordEmbedder());
    if (seeded.status !== 'open') throw new Error(`course file: ${seeded.status}`);
    const [first] = seeded.course.slides();
    if (first === undefined) throw new Error('seeded course has no slides');
    seeded.course.setTopics(sourceIdOf(first), ['castes']);
    seeded.course.close();
    markOlder(dataDir);
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'rebuilt' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: HIVE_STORED,
      repair: { state: 'done', discarded: [{ table: 'topics', rows: 1 }] },
    });
  });

  it('logs a repair that throws, and leaves the course unavailable', async () => {
    const dataDir = await seededDataDir();
    const server = await restarted(dataDir, new RepinnedShortEmbedder(3));
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'Error' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: { state: 'course-unavailable', problem: 'embedder-mismatch' },
      repair: { state: 'failed' },
    });
  });

  it('logs a course file it cannot repair by the reason it cannot be opened', async () => {
    const seeding = await startTestServer();
    await seeding.server.close();
    const path = courseFilePath(seeding.dataDir, BIO);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a course file');
    const server = await restarted(seeding.dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'not-a-course-file' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: { state: 'course-unavailable', problem: 'not-a-course-file' },
      repair: { state: 'failed' },
    });
  });

  it('logs nothing for a course file that needs no repair, and leaves it closed', async () => {
    const dataDir = await seededDataDir();
    const server = await restarted(dataDir);
    await upload(server.server.port, await pdfDeck([['Drones', 'Drones are female.']]), 'l2');
    expect((await settledStatus(server.server.port, 'bio')).json).toMatchObject({
      repair: { state: 'done', discarded: [] },
    });
    expect(server.logs).toEqual([]);
    expect(existsSync(`${courseFilePath(dataDir, BIO)}-wal`)).toBe(false);
  });
});
