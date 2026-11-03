import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ChunkNo, CourseId, LectureSlides, SourceId, TopicTag } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import { openedUnder, restarted, seededDataDir, stopRestarted, uploadTo } from './repair-fixture';
import {
  GatedEmbedder,
  pdfDeck,
  type Received,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  type TestServer,
  WordEmbedder,
} from './server-fixture';
import { MAX_TAG_EDIT_BYTES } from './tag-handlers';

const QUEEN = ['The queen', 'One queen per colony', 'She lays every egg'];
const SWARM = ['Swarming', 'Swarm watch begins when the bloom count passes forty'];
const FIRST = { sourceId: 'l1/1', chunkNo: 1 };
/** QUEEN's chunk's list as `hive` stores it and the GET serves it. */
const HELD = [
  { tag: 'castes', origin: 'student' },
  { tag: 'the queen', origin: 'tagger' },
];
const EDIT = { ...FIRST, base: HELD };

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
  await stopRestarted();
});

/** A `bio` course holding QUEEN and SWARM as lecture `l1`, QUEEN's chunk tagged by the tagger and the student. */
const hive = async (): Promise<TestServer> => {
  test = await startTestServer();
  await uploadTo(test.server.port, await pdfDeck([QUEEN, SWARM]));
  await settledStatus(test.server.port, 'bio');
  const opened = await openedUnder(test.dataDir, new WordEmbedder());
  if (opened.status !== 'open') throw new Error(`course file: ${opened.status}`);
  const fact = { sourceId: SourceId.parse('l1/1'), chunkNo: ChunkNo.parse(1) };
  opened.course.setTopics(fact, 'tagger', [TopicTag.parse('the queen'), TopicTag.parse('castes')]);
  opened.course.setTopics(fact, 'student', [TopicTag.parse('castes')]);
  opened.course.close();
  return test;
};

const slides = (port: number, query: string, courseId = 'bio'): Promise<Received> =>
  send(port, { method: 'GET', path: `/courses/${courseId}/slides${query}` });

const lecture = (port: number) => slides(port, '?lectureId=l1');

const put = (port: number, body: unknown, courseId = 'bio', type = 'application/json') =>
  send(port, {
    method: 'PUT',
    path: `/courses/${courseId}/tags`,
    headers: { 'content-type': type },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const firstChunkTags = (received: Received) =>
  LectureSlides.parse(received.json).slides[0]?.chunks[0]?.tags;

const brokenCourseFile = (dataDir: string, content: string): void => {
  const path = courseFilePath(dataDir, CourseId.parse('bio'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

describe('GET /courses/:id/slides', () => {
  it('serves the lecture’s slides in order, each chunk’s lines and its tags once, sorted, a tag both origins hold as the student’s', async () => {
    const { server } = await hive();
    const received = await lecture(server.port);
    expect(received.status).toBe(200);
    const served = LectureSlides.parse(received.json);
    expect(served.lectureId).toBe('l1');
    expect(served.slides.map(({ sourceId, record }) => [sourceId, record.title])).toEqual([
      ['l1/1', 'The queen'],
      ['l1/2', 'Swarming'],
    ]);
    expect(served.slides.map(({ chunks }) => chunks)).toEqual([
      [
        {
          chunkNo: 1,
          lines: ['One queen per colony', 'She lays every egg'],
          tags: [
            { tag: 'castes', origin: 'student' },
            { tag: 'the queen', origin: 'tagger' },
          ],
        },
      ],
      [{ chunkNo: 1, lines: [SWARM[1]], tags: [] }],
    ]);
  });

  it('refuses a malformed course id or lecture id, a course or lecture it does not know, and names an unreadable file', async () => {
    const { server, dataDir } = await hive();
    const refusals = [
      [await slides(server.port, '?lectureId=l1', 'Bio'), 400, 'bad-request'],
      [await slides(server.port, ''), 400, 'bad-request'],
      [await slides(server.port, '?lectureId='), 400, 'bad-request'],
      [await slides(server.port, '?lectureId=l1', 'chem'), 404, 'no-such-course'],
      [await slides(server.port, '?lectureId=l2'), 404, 'not-found'],
    ] as const;
    for (const [received, status, refusal] of refusals)
      expect([received.status, received.json]).toMatchObject([status, { status: refusal }]);
    brokenCourseFile(dataDir, 'not a course file');
    expect(await lecture(server.port)).toMatchObject({
      status: 409,
      json: { status: 'course-unavailable', problem: 'not-a-course-file' },
    });
  });

  it('reads a blank course file as holding no lecture', async () => {
    test = await startTestServer();
    brokenCourseFile(test.dataDir, '');
    expect(await lecture(test.server.port)).toMatchObject({
      status: 404,
      json: { status: 'not-found' },
    });
  });

  it('answers only GET', async () => {
    const { server } = await hive();
    const posted = await send(server.port, { method: 'POST', path: '/courses/bio/slides' });
    expect([posted.status, posted.headers.allow]).toEqual([405, 'GET']);
  });
});

describe('PUT /courses/:id/tags', () => {
  it('sets the chunk’s whole list, keeping a held tag’s origin, and a later read and a restarted server read it back', async () => {
    const { server, dataDir } = await hive();
    const edited = await put(server.port, { ...EDIT, tags: ['the queen', 'swarming'] });
    const expected = [
      { tag: 'swarming', origin: 'student' },
      { tag: 'the queen', origin: 'tagger' },
    ];
    expect(edited).toMatchObject({ status: 200, json: { ...FIRST, tags: expected } });
    expect(firstChunkTags(await lecture(server.port))).toEqual(expected);
    await server.close();
    test = undefined;
    const again = await restarted(dataDir);
    expect(firstChunkTags(await lecture(again.server.port))).toEqual(expected);
  });

  it('leaves the slide’s other chunks and slides as they were', async () => {
    const { server } = await hive();
    await put(server.port, { sourceId: 'l1/2', chunkNo: 1, base: [], tags: ['bloom count'] });
    const served = LectureSlides.parse((await lecture(server.port)).json);
    expect(served.slides.map(({ chunks }) => chunks.map(({ tags }) => tags))).toEqual([
      [
        [
          { tag: 'castes', origin: 'student' },
          { tag: 'the queen', origin: 'tagger' },
        ],
      ],
      [[{ tag: 'bloom count', origin: 'student' }]],
    ]);
  });

  it('refuses a body that is not JSON, too large, or not a tag edit, and a course or chunk it does not know', async () => {
    const { server, dataDir } = await hive();
    const tags = ['castes'];
    const oversized = JSON.stringify({ ...EDIT, tags: ['x'.repeat(MAX_TAG_EDIT_BYTES)] });
    const refusals = [
      [
        await put(server.port, { ...EDIT, tags }, 'bio', 'text/plain'),
        415,
        'unsupported-media-type',
      ],
      [await put(server.port, oversized), 413, 'payload-too-large'],
      [await put(server.port, '{'), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags: ['castes '] }), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags, origin: 'tagger' }), 400, 'bad-request'],
      [await put(server.port, { ...FIRST, tags }), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags }, 'Bio'), 400, 'bad-request'],
      [await put(server.port, { ...EDIT, tags }, 'chem'), 404, 'no-such-course'],
      [await put(server.port, { ...EDIT, chunkNo: 2, tags }), 404, 'not-found'],
      [await put(server.port, { ...EDIT, sourceId: 'l9/1', tags }), 404, 'not-found'],
    ] as const;
    for (const [received, status, refusal] of refusals)
      expect([received.status, received.json]).toMatchObject([status, { status: refusal }]);
    expect(firstChunkTags(await lecture(server.port))).toHaveLength(2);
    brokenCourseFile(dataDir, 'not a course file');
    expect(await put(server.port, { ...EDIT, tags })).toMatchObject({
      status: 409,
      json: { status: 'course-unavailable', problem: 'not-a-course-file' },
    });
  });

  it('waits behind an upload already queued, so the re-uploaded lecture keeps the edit', async () => {
    const gated = new GatedEmbedder();
    const { server } = await restarted(await seededDataDir([QUEEN, SWARM]), gated);
    await uploadTo(server.port, await pdfDeck([QUEEN, ['Drones', 'Drones do not forage']]));
    const edit = put(server.port, { ...FIRST, base: [], tags: ['royalty'] });
    gated.open();
    expect(await edit).toMatchObject({ status: 200 });
    await settledStatus(server.port, 'bio');
    expect(firstChunkTags(await lecture(server.port))).toEqual([
      { tag: 'royalty', origin: 'student' },
    ]);
  });

  it('refuses an edit made against a list other than the chunk’s, sending the chunk’s and writing nothing', async () => {
    const { server } = await hive();
    const stale = [
      [HELD[0]],
      [...HELD, { tag: 'drones', origin: 'student' }],
      [{ tag: 'castes', origin: 'tagger' }, HELD[1]],
      [HELD[0], { tag: 'the queen', origin: 'student' }],
      [{ tag: 'caste', origin: 'student' }, HELD[1]],
      [HELD[0], HELD[0], HELD[1]],
      [HELD[0], HELD[1], HELD[1]],
      [HELD[0], { tag: 'castes', origin: 'tagger' }, HELD[1]],
      [],
    ];
    for (const base of stale)
      expect(
        await put(server.port, { ...FIRST, base, tags: ['royalty'] }),
        JSON.stringify(base),
      ).toMatchObject({ status: 409, json: { status: 'tags-changed', tags: HELD } });
    expect(firstChunkTags(await lecture(server.port))).toEqual(HELD);
  });

  it('matches a base listed in another order', async () => {
    const { server } = await hive();
    const edited = await put(server.port, { ...FIRST, base: [...HELD].reverse(), tags: [] });
    expect(edited).toMatchObject({ status: 200, json: { ...FIRST, tags: [] } });
  });

  it('refuses the second of two edits made against the same list, whichever reaches the queue last', async () => {
    const { server } = await hive();
    const [first, second] = await Promise.all([
      put(server.port, { ...EDIT, tags: ['castes', 'drones'] }),
      put(server.port, { ...EDIT, tags: ['royalty'] }),
    ]);
    const answers = [first, second].map((received) => received.status).sort();
    expect(answers).toEqual([200, 409]);
    const won = first.status === 200 ? first : second;
    const lost = first.status === 200 ? second : first;
    const stored = firstChunkTags(await lecture(server.port));
    expect(won.json).toMatchObject({ tags: stored });
    expect(lost.json).toEqual({ status: 'tags-changed', tags: stored });
  });

  it('says a chunk that is gone is not found, whatever list the edit was made against', async () => {
    const { server } = await hive();
    expect(await put(server.port, { ...EDIT, chunkNo: 2, tags: [] })).toMatchObject({
      status: 404,
      json: { status: 'not-found' },
    });
  });

  it('answers only PUT', async () => {
    const { server } = await hive();
    const got = await send(server.port, { method: 'GET', path: '/courses/bio/tags' });
    expect([got.status, got.headers.allow]).toEqual([405, 'PUT']);
  });
});
