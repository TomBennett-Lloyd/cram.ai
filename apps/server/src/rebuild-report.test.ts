import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CourseId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import {
  GatedEmbedder,
  gatewayOf,
  PDF,
  pdfDeck,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
} from './server-fixture';

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const started = async (embedder?: GatedEmbedder): Promise<TestServer> => {
  test = await startTestServer(embedder === undefined ? undefined : gatewayOf([], embedder));
  return test;
};

const SHOWN = 'a'.repeat(64);

const dismiss = (port: number, courseId = 'bio', query = `?revision=${SHOWN}`) =>
  send(port, { method: 'DELETE', path: `/courses/${courseId}/rebuild-report${query}` });

const upload = async (port: number, courseId = 'bio') =>
  send(port, {
    method: 'POST',
    path: uploadPath(courseId, 'l1', 'hive.pdf'),
    headers: { 'content-type': PDF },
    body: await pdfDeck([['The Hive', 'Worker bees are male in this course.']]),
  });

describe('DELETE /courses/:id/rebuild-report', () => {
  it('dismisses a course’s empty report as it would a full one', async () => {
    const { server } = await started();
    await upload(server.port);
    await settledStatus(server.port, 'bio');
    expect(await dismiss(server.port)).toMatchObject({
      status: 200,
      json: { status: 'dismissed' },
    });
  });

  it('runs behind the writes queued before it, so a course still being created is found', async () => {
    const embedder = new GatedEmbedder();
    const { server } = await started(embedder);
    await upload(server.port);
    const dismissed = dismiss(server.port);
    embedder.open();
    expect(await dismissed).toMatchObject({ status: 200, json: { status: 'dismissed' } });
  });

  it('answers no-such-course for a course with no file', async () => {
    const { server } = await started();
    expect(await dismiss(server.port)).toMatchObject({
      status: 404,
      json: { status: 'no-such-course' },
    });
  });

  it('answers course-unavailable, with the reason, for a file it cannot open', async () => {
    const { server, dataDir } = await started();
    const path = courseFilePath(dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a course file');
    expect(await dismiss(server.port)).toMatchObject({
      status: 409,
      json: { status: 'course-unavailable', problem: 'not-a-course-file' },
    });
  });

  it('answers a dismissal that throws as an internal error, and the queue runs on', async () => {
    const { server, dataDir, logs } = await started();
    mkdirSync(courseFilePath(dataDir, CourseId.parse('bio')), { recursive: true });
    expect(await dismiss(server.port)).toMatchObject({ status: 500 });
    expect(logs).toMatchObject([{ operation: 'DELETE /courses/bio/rebuild-report' }]);
    await upload(server.port, 'chem');
    expect((await settledStatus(server.port, 'chem')).json).toMatchObject({
      uploads: [{ progress: { state: 'indexed' } }],
    });
  });

  it('refuses a dismissal that names no report revision, or a malformed one', async () => {
    const { server } = await started();
    await upload(server.port);
    await settledStatus(server.port, 'bio');
    for (const query of ['', '?revision=', `?revision=${'a'.repeat(63)}`, `?other=${SHOWN}`])
      expect(await dismiss(server.port, 'bio', query)).toMatchObject({
        status: 400,
        json: { status: 'bad-request' },
      });
  });

  it('refuses a course id the route does not take, and any other method', async () => {
    const { server } = await started();
    expect(await dismiss(server.port, 'Bio')).toMatchObject({ status: 400 });
    const read = await send(server.port, { method: 'GET', path: '/courses/bio/rebuild-report' });
    expect(read).toMatchObject({ status: 405, headers: { allow: 'DELETE' } });
  });
});
