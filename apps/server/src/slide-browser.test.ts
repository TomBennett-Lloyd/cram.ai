import { LectureSlides } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  brokenCourseFile,
  hive,
  lecture,
  pageHash,
  QUEEN,
  slides,
  startServer,
  stopStarted,
  SWARM,
} from './slide-browser-fixture';
import { send } from './server-fixture';

afterEach(stopStarted);

describe('GET /courses/:id/slides', () => {
  it('serves the lecture’s slides in order, each chunk’s text hash, lines and its tags once, sorted, a tag both origins hold as the student’s', async () => {
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
          textHash: pageHash(QUEEN),
          lines: ['One queen per colony', 'She lays every egg'],
          tags: [
            { tag: 'castes', origin: 'student' },
            { tag: 'the queen', origin: 'tagger' },
          ],
        },
      ],
      [{ chunkNo: 1, textHash: pageHash(SWARM), lines: [SWARM[1]], tags: [] }],
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
    const test = await startServer();
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
