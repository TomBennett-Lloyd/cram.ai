import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coursesDirectory } from './data-directory';
import {
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

const started = async (): Promise<TestServer> => {
  test = await startTestServer();
  return test;
};

const listed = (server: TestServer) =>
  send(server.server.port, { method: 'GET', path: '/courses' });

const uploadTo = async ({ server }: TestServer, courseId: string, body: Uint8Array | string) => {
  const path = uploadPath(courseId, 'l1', 'deck.pdf');
  await send(server.port, { method: 'POST', path, headers: { 'content-type': PDF }, body });
  await settledStatus(server.port, courseId);
};

const storeFiles = ({ dataDir }: TestServer, names: readonly string[]): void => {
  mkdirSync(coursesDirectory(dataDir), { recursive: true });
  for (const name of names) writeFileSync(join(coursesDirectory(dataDir), name), '');
};

describe('GET /courses', () => {
  it('lists no course before anything was uploaded', async () => {
    const response = await listed(await started());
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ courses: [] });
  });

  it('lists every course with an indexed deck, in id order', async () => {
    const server = await started();
    const deck = await pdfDeck([['Bees', 'Worker bees forage.']]);
    await uploadTo(server, 'zoo', deck);
    await uploadTo(server, 'bio', deck);
    expect((await listed(server)).json).toEqual({ courses: ['bio', 'zoo'] });
  });

  it('lists a course whose only upload wrote no course file', async () => {
    const server = await started();
    await uploadTo(server, 'chem', 'not a pdf');
    expect((await listed(server)).json).toEqual({ courses: ['chem'] });
  });

  it('lists stored course files and uploaded-to courses once each, in id order', async () => {
    const server = await started();
    storeFiles(server, [
      'zed.sqlite',
      'geo.sqlite',
      'geo.sqlite-wal',
      'Art.sqlite',
      'two words.sqlite',
      'con.sqlite',
      'notes.txt',
      'sqlite',
    ]);
    await uploadTo(server, 'geo', 'not a pdf');
    await uploadTo(server, 'chem', 'not a pdf');
    expect((await listed(server)).json).toEqual({ courses: ['chem', 'geo', 'zed'] });
  });

  it('answers 500 when the courses directory is not a directory', async () => {
    const server = await started();
    writeFileSync(coursesDirectory(server.dataDir), '');
    expect((await listed(server)).status).toBe(500);
    expect(server.logs).toEqual([{ operation: 'GET /courses', courseId: '', outcome: 'Error' }]);
  });

  it('answers any method but GET with 405, and a trailing slash with 404', async () => {
    const { server } = await started();
    const posted = await send(server.port, { method: 'POST', path: '/courses' });
    expect(posted.status).toBe(405);
    expect(posted.headers.allow).toBe('GET');
    expect((await send(server.port, { method: 'GET', path: '/courses/' })).status).toBe(404);
  });
});
