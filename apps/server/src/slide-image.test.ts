import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CourseId, Deck, SlideImage } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import { openedUnder } from './repair-fixture';
import {
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

/** Lecture 1 of the synthetic deck (`eval/decks/hollowmere/lecture-01.json`), two slides of it. */
const COLONY = [
  ['The queen', 'One queen per colony', "The queen is the colony's only female"],
  ['The drones', 'Drones are larger than workers and have no sting'],
];

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const imagePath = (lectureId: string, slideNo: string, courseId = 'bio'): string =>
  `/courses/${courseId}/slide-image?${new URLSearchParams({ lectureId, slideNo }).toString()}`;

const fetchImage = (server: TestServer, path: string) => fetch(new URL(path, server.server.origin));

const withColony = async (): Promise<TestServer> => {
  test = await startTestServer();
  await send(test.server.port, {
    method: 'POST',
    path: uploadPath('bio', 'lecture-01', 'colony.pdf'),
    headers: { 'content-type': PDF },
    body: await pdfDeck(COLONY),
  });
  await settledStatus(test.server.port, 'bio');
  return test;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('GET /courses/:id/slide-image', () => {
  it('sends a stored slide’s rendering, same-origin only: an <img> from another site sends no Origin to refuse', async () => {
    const server = await withColony();
    const response = await fetchImage(server, imagePath('lecture-01', '2'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(response.headers.get('content-length')).toBe(String(bytes.length));
  });

  it('sends each slide its own rendering', async () => {
    const server = await withColony();
    const [one, two] = await Promise.all(
      ['1', '2'].map(async (slideNo) =>
        Buffer.from(
          await (await fetchImage(server, imagePath('lecture-01', slideNo))).arrayBuffer(),
        ),
      ),
    );
    expect(one?.equals(two ?? Buffer.alloc(0))).toBe(false);
  });

  it('sends a JPEG rendering as a JPEG', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cram-server-'));
    mkdirSync(dirname(courseFilePath(dataDir, CourseId.parse('bio'))), { recursive: true });
    const opened = await openedUnder(dataDir, new WordEmbedder());
    if (opened.status !== 'open') throw new Error(`course file: ${opened.status}`);
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    opened.course.replaceLecture(
      Deck.parse({
        lectureId: 'lecture-01',
        lectureTitle: 'The colony and its castes',
        mediaType: 'application/pdf',
        content: new Uint8Array([1]),
      }),
      [SlideImage.parse({ slideNo: 1, mediaType: 'image/jpeg', content })],
      [],
    );
    opened.course.close();
    test = await startTestServer(undefined, dataDir);
    const response = await fetchImage(test, imagePath('lecture-01', '1'));
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content);
  });

  it('answers not-found for a slide or lecture with no stored image', async () => {
    const server = await withColony();
    for (const path of [imagePath('lecture-01', '3'), imagePath('lecture-02', '1')]) {
      const response = await fetchImage(server, path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ status: 'not-found' });
    }
  });

  it('answers no-such-course for a course with no file', async () => {
    test = await startTestServer();
    const response = await fetchImage(test, imagePath('lecture-01', '1'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'no-such-course' });
  });

  it('answers not-found from a blank course file', async () => {
    test = await startTestServer();
    const path = courseFilePath(test.dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    const response = await fetchImage(test, imagePath('lecture-01', '1'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'not-found' });
  });

  it('answers course-unavailable, with the reason, for a file it cannot open', async () => {
    test = await startTestServer();
    const path = courseFilePath(test.dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a course file');
    const response = await fetchImage(test, imagePath('lecture-01', '1'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: 'course-unavailable',
      problem: 'not-a-course-file',
    });
  });

  it('refuses a course id the schema refuses, and a missing lecture', async () => {
    test = await startTestServer();
    expect((await fetchImage(test, imagePath('lecture-01', '1', 'Bio'))).status).toBe(400);
    expect((await fetchImage(test, '/courses/bio/slide-image?slideNo=1')).status).toBe(400);
    expect((await fetchImage(test, imagePath('', '1'))).status).toBe(400);
  });

  it('allows GET only', async () => {
    test = await startTestServer();
    const response = await send(test.server.port, {
      method: 'POST',
      path: imagePath('lecture-01', '1'),
    });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
  });

  /** The oracle is how JavaScript itself writes the number back, never the route's own pattern. */
  const isPageNumber = (text: string): boolean => {
    const value = Number(text);
    return String(value) === text && Number.isSafeInteger(value) && value >= 1;
  };
  const SLIDE_NUMBERS = [
    ...['1', '2', '9', '10', '19', '20', '100'],
    ...['0', '00', '01', '010', '-1', '+1', '1.0', '1.', '.1', '1e0', '1e3'],
    ...[' 1', '1 ', '1\n', '\t1', '0x1', '0b1', '0o1', '1_0', '', ' ', 'one', 'Infinity', 'NaN'],
    ...['١', '１', '9007199254740991', '9007199254740992', '9007199254740993', '1a', 'a1'],
  ];

  it('reads a slide number only as a page number is written', async () => {
    const server = await withColony();
    const verdicts = await Promise.all(
      SLIDE_NUMBERS.map(async (slideNo) => {
        const { status } = await fetchImage(server, imagePath('lecture-01', slideNo));
        return [slideNo, status !== 400];
      }),
    );
    expect(verdicts).toEqual(SLIDE_NUMBERS.map((slideNo) => [slideNo, isPageNumber(slideNo)]));
  });
});
