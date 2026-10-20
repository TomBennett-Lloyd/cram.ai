import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname } from 'node:path';
import { CourseId, LectureId } from '@cram/shared';
import { EmbedderIdentity, openCourse } from '@cram/index';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import { MAX_ASK_BYTES, MAX_DECK_BYTES } from './handlers';
import {
  FailingEmbedder,
  gatewayOf,
  PDF,
  pdfDeck,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
  WordEmbedder,
} from './server-fixture';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const HIVE = [['The Hive', 'Worker bees are male in this course.'], []];

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const started = async (server?: Promise<TestServer>): Promise<TestServer> => {
  test = await (server ?? startTestServer());
  return test;
};

const upload = async (
  { server }: TestServer,
  body: Uint8Array | string,
  contentType = PDF,
  path = uploadPath('bio', 'l1', 'hive.pdf'),
) => send(server.port, { method: 'POST', path, headers: { 'content-type': contentType }, body });

/** The `l1` deck in the `bio` course file, opened under the identity `WordEmbedder`'s pin names. */
const lectureDeckIn = (dataDir: string) => {
  const { pin } = new WordEmbedder();
  const opened = openCourse({
    path: courseFilePath(dataDir, CourseId.parse('bio')),
    courseId: CourseId.parse('bio'),
    embedder: EmbedderIdentity.parse({ model: `${pin.model}@${pin.sha256}`, dimension: 8 }),
  });
  if (opened.status !== 'open') throw new Error(`course file: ${opened.status}`);
  try {
    return opened.course.deck(LectureId.parse('l1'));
  } finally {
    opened.course.close();
  }
};

/** Streams `bytes` zero bytes as a deck, one reused mebibyte at a time; answers the status code. */
const uploadZeros = ({ server }: TestServer, bytes: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const sent = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        method: 'POST',
        path: uploadPath('bio', 'l1', 'big.pdf'),
        headers: { 'content-type': PDF },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve(response.statusCode ?? 0);
        });
      },
    );
    sent.on('error', reject);
    const chunk = new Uint8Array(1024 * 1024);
    let left = bytes;
    for (; left >= chunk.length; left -= chunk.length) sent.write(chunk);
    sent.end(chunk.subarray(0, left));
  });

const progressOf = async ({ server }: TestServer, courseId = 'bio') =>
  (
    (await settledStatus(server.port, courseId)).json as { uploads: { progress: unknown }[] }
  ).uploads.map(({ progress }) => progress);

describe('POST /courses/:id/decks', () => {
  it('queues the deck, then indexes it and flags its image-only pages by slide number', async () => {
    const server = await started();
    const accepted = await upload(server, await pdfDeck(HIVE), 'Application/PDF ; charset=binary');
    expect(accepted.status).toBe(202);
    expect(accepted.json).toMatchObject({
      lectureId: 'l1',
      fileName: 'hive.pdf',
      progress: { state: 'queued' },
    });
    const status = await settledStatus(server.server.port, 'bio');
    expect(status.status).toBe(200);
    expect(status.json).toEqual({
      courseId: 'bio',
      uploads: [
        {
          uploadId: (accepted.json as { uploadId: string }).uploadId,
          lectureId: 'l1',
          fileName: 'hive.pdf',
          progress: { state: 'indexed', slideCount: 2, imageOnly: [2] },
        },
      ],
    });
  });

  it('reports a deck its bytes cannot yield as unreadable, in the adapter its media type names', async () => {
    const server = await started();
    await upload(server, 'not a deck');
    await upload(server, 'not a deck', PPTX);
    expect(await progressOf(server)).toEqual([
      expect.objectContaining({ state: 'unreadable', reason: 'not-a-pdf' }),
      expect.objectContaining({ state: 'unreadable', reason: 'not-a-pptx' }),
    ]);
  });

  it('marks an upload failed when indexing throws, and logs the error by name alone', async () => {
    const server = await started(startTestServer(gatewayOf([], new FailingEmbedder())));
    await upload(server, await pdfDeck(HIVE));
    expect(await progressOf(server)).toEqual([{ state: 'failed' }]);
    expect(server.logs).toEqual([{ operation: 'ingest', courseId: 'bio', outcome: 'Error' }]);
  });

  it('reports a course file it cannot open as unavailable, naming the index’s reason', async () => {
    const server = await started();
    const path = courseFilePath(server.dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a course file');
    await upload(server, await pdfDeck(HIVE));
    expect(await progressOf(server)).toEqual([
      { state: 'course-unavailable', problem: 'not-a-course-file' },
    ]);
  });

  it('refuses an upload missing its lecture id or file name', async () => {
    const server = await started();
    const deck = await pdfDeck(HIVE);
    for (const path of [
      '/courses/bio/decks?fileName=hive.pdf',
      '/courses/bio/decks?lectureId=l1',
      '/courses/bio/decks?lectureId=l1&fileName=%20',
    ]) {
      expect((await upload(server, deck, PDF, path)).json).toMatchObject({ status: 'bad-request' });
    }
  });

  it('refuses a deck of a media type no adapter reads, and an empty one', async () => {
    const server = await started();
    expect((await upload(server, 'slides', 'text/plain')).status).toBe(415);
    expect((await upload(server, 'slides', '')).status).toBe(415);
    const empty = await upload(server, '');
    expect(empty.status).toBe(400);
    expect(empty.json).toEqual({ status: 'bad-request', issue: 'the deck is empty' });
  });

  it('refuses a deck one byte over its cap, and accepts one longer than a question may be', async () => {
    const server = await started();
    expect(await uploadZeros(server, MAX_DECK_BYTES + 1)).toBe(413);
    expect(await uploadZeros(server, MAX_ASK_BYTES + 1)).toBe(202);
  });
});

describe('the course file an upload writes', () => {
  it('stores the deck under the embedder the pin and its vectors name', async () => {
    const server = await started();
    const deck = await pdfDeck(HIVE);
    await upload(server, deck);
    await settledStatus(server.server.port, 'bio');
    const stored = lectureDeckIn(server.dataDir);
    expect(stored?.lectureTitle).toBe('The Hive');
    expect(new Uint8Array(stored?.content ?? [])).toEqual(deck);
  });

  it('is written before close resolves, though the upload was still queued', async () => {
    const server = await started();
    await upload(server, await pdfDeck(HIVE));
    await server.server.close();
    test = undefined;
    expect(lectureDeckIn(server.dataDir)?.lectureTitle).toBe('The Hive');
    rmSync(server.dataDir, { recursive: true, force: true });
  });

  it('outlives the server: after a restart the course has no uploads, and is not missing', async () => {
    const server = await started();
    await upload(server, await pdfDeck(HIVE));
    await server.server.close();
    test = await startTestServer(undefined, server.dataDir);
    const status = await send(test.server.port, { method: 'GET', path: '/courses/bio/ingest' });
    expect(status.status).toBe(200);
    expect(status.json).toEqual({ courseId: 'bio', uploads: [] });
  });
});

describe('GET /courses/:id/ingest', () => {
  it('answers no-such-course for a course with no file and no uploads', async () => {
    const { server } = await started();
    const status = await send(server.port, { method: 'GET', path: '/courses/bio/ingest' });
    expect(status.status).toBe(404);
    expect(status.json).toEqual({ status: 'no-such-course' });
  });

  it('accepts only a course id that can name a file on every platform', async () => {
    const { server } = await started();
    const statusOf = async (courseId: string) =>
      (await send(server.port, { method: 'GET', path: `/courses/${courseId}/ingest` })).status;
    for (const accepted of ['b', 'bio-101', '7', 'a'.repeat(64), 'con1', 'com0', 'lpt0', 'bacon'])
      expect(await statusOf(accepted), accepted).toBe(404);
    for (const refused of [
      'Bio',
      '.bio',
      '-bio',
      'bio-',
      'bio_1',
      'bi.o',
      'bio%2F1',
      'a'.repeat(65),
      'con',
      'prn',
      'aux',
      'nul',
      'com1',
      'com9',
      'lpt1',
      'lpt9',
    ])
      expect(await statusOf(refused), refused).toBe(400);
  });
});
