import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openCourse, SCHEMA_VERSION } from '@cram/index';
import { CourseId, Deck } from '@cram/shared';
import { expect } from 'vitest';
import { courseFilePath } from './data-directory';
import {
  FailingEmbedder,
  GatedEmbedder,
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
import { embedderIdentity } from './slide-embedding';

export const BIO = CourseId.parse('bio');
export const HIVE = [['The Hive', 'Worker bees are male in this course.'], []];
export const HIVE_STORED = {
  state: 'read',
  lectures: [
    { lectureId: 'l1', lectureTitle: 'The Hive', slideCount: 2, imageOnly: [2], unembedded: [] },
  ],
  report: { state: 'none' },
};

/** `WordEmbedder`'s vectors under another pin, so a file it wrote records another embedder. */
class RepinnedEmbedder extends WordEmbedder {
  override readonly pin = { ...new WordEmbedder().pin, model: 'fixture/repinned-embedder' };
}

export class RepinnedGatedEmbedder extends GatedEmbedder {
  override readonly pin = new RepinnedEmbedder().pin;
}

export class RepinnedShortEmbedder extends ShortEmbedder {
  override readonly pin = new RepinnedEmbedder().pin;
}

export class RepinnedFailingEmbedder extends FailingEmbedder {
  override readonly pin = new RepinnedEmbedder().pin;
}

export const uploadTo = (
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
export const seededDataDir = async (
  pages: readonly (readonly string[])[] = HIVE,
  fileName?: string,
): Promise<string> => {
  const seeding = await startTestServer();
  await uploadTo(seeding.server.port, await pdfDeck(pages), 'l1', fileName);
  await settledStatus(seeding.server.port, 'bio');
  await seeding.server.close();
  return seeding.dataDir;
};

/** Rewrites the `user_version` field of the SQLite file header, by default to the previous schema. */
export const markOlder = (dataDir: string, version = SCHEMA_VERSION - 1): void => {
  const path = courseFilePath(dataDir, BIO);
  expect(existsSync(`${path}-wal`)).toBe(false);
  const file = readFileSync(path);
  file.writeUInt32BE(version, 60);
  writeFileSync(path, file);
};

/** An older-schema `bio` course file holding one stored PDF deck as lecture `l1`, and no slides. */
export const olderDataDir = async (lectureTitle: string, content: Uint8Array): Promise<string> => {
  const seeding = await startTestServer();
  await seeding.server.close();
  const path = courseFilePath(seeding.dataDir, BIO);
  mkdirSync(dirname(path), { recursive: true });
  const opened = openCourse({
    path,
    courseId: BIO,
    embedder: await embedderIdentity(new WordEmbedder()),
  });
  if (opened.status !== 'open') throw new Error(`course file: ${opened.status}`);
  opened.course.replaceLecture(
    Deck.parse({ lectureId: 'l1', lectureTitle, mediaType: PDF, content }),
    [],
    [],
  );
  opened.course.close();
  markOlder(seeding.dataDir);
  return seeding.dataDir;
};

let latest: TestServer | undefined;

/** A server on `dataDir`; the latest one started is stopped by `stopRestarted`. */
export const restarted = async (
  dataDir: string,
  embedder = new WordEmbedder(),
): Promise<TestServer> => {
  latest = await startTestServer(gatewayOf([], embedder), dataDir);
  return latest;
};

export const stopRestarted = async (): Promise<void> => {
  if (latest !== undefined) await stopTestServer(latest);
  latest = undefined;
};

export const repairLog = async ({ logs }: TestServer) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const repairs = logs.filter(({ operation }) => operation === 'repair');
    if (repairs.length > 0) return repairs;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('repairLog: no repair was logged');
};

/** The `bio` course's ingest status once its repair has finished. */
export const repairedStatus = async ({ server }: TestServer) => {
  const { stored, repair } = (await settledStatus(server.port, 'bio')).json as {
    stored: unknown;
    repair: unknown;
  };
  return { stored, repair };
};

/** The `bio` course file as `embedder` opens it. */
export const openedUnder = async (dataDir: string, embedder: WordEmbedder) =>
  openCourse({
    path: courseFilePath(dataDir, BIO),
    courseId: BIO,
    embedder: await embedderIdentity(embedder),
  });
