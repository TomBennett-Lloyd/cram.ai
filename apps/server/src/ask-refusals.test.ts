import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CourseId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import { MAX_ASK_BYTES } from './handlers';
import {
  FailingEmbedder,
  gatewayOf,
  type Received,
  send,
  ShortEmbedder,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './server-fixture';

const QUESTION = 'Who are the workers?';

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const askBio = (
  { server }: TestServer,
  body: string = JSON.stringify({ question: QUESTION }),
  contentType = 'application/json',
): Promise<Received> =>
  send(server.port, {
    method: 'POST',
    path: '/courses/bio/ask',
    headers: { 'content-type': contentType },
    body,
  });

describe('POST /courses/:id/ask, before any model is asked', () => {
  it('answers no-such-course for a course with no file', async () => {
    test = await startTestServer();
    const reply = await askBio(test);
    expect(reply.status).toBe(404);
    expect(reply.json).toEqual({ status: 'no-such-course' });
  });

  it('answers course-unavailable for a course file it cannot open', async () => {
    test = await startTestServer();
    const path = courseFilePath(test.dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a course file');
    const reply = await askBio(test);
    expect(reply.status).toBe(409);
    expect(reply.json).toEqual({ status: 'course-unavailable', problem: 'not-a-course-file' });
  });

  it('answers not-covered from a blank course file, and leaves it blank', async () => {
    test = await startTestServer();
    const path = courseFilePath(test.dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    const reply = await askBio(test);
    expect(reply.json).toEqual({ status: 'not-covered', withheld: [], slides: [], leftOut: [] });
    expect(statSync(path).size).toBe(0);
  });

  it('refuses a body that is not a JSON question', async () => {
    test = await startTestServer();
    expect((await askBio(test, JSON.stringify({ question: ' ' }))).status).toBe(400);
    expect((await askBio(test, '{"question":')).status).toBe(400);
    expect((await askBio(test, JSON.stringify({ question: QUESTION }), 'text/plain')).status).toBe(
      415,
    );
    const bodyOf = (bytes: number) => {
      const body = JSON.stringify({ question: 'q'.repeat(bytes - '{"question":""}'.length) });
      expect(body).toHaveLength(bytes);
      return body;
    };
    const large = await askBio(test, bodyOf(MAX_ASK_BYTES + 1));
    expect(large.status).toBe(413);
    expect(large.json).toEqual({ status: 'payload-too-large' });
    expect((await askBio(test, bodyOf(MAX_ASK_BYTES))).status).toBe(404);
  });

  it('refuses a question longer than the embedder takes, with its limit', async () => {
    test = await startTestServer(gatewayOf([], new ShortEmbedder(6)));
    const path = courseFilePath(test.dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    const long = JSON.stringify({ question: 'why do the worker bees of the hive dance so' });
    const reply = await askBio(test, long);
    expect(reply.status).toBe(422);
    expect(reply.json).toEqual({ status: 'question-over-length', maxInputTokens: 6 });
  });

  it('answers 500 when retrieval throws, logging the error by name alone', async () => {
    test = await startTestServer(gatewayOf([], new FailingEmbedder()));
    const path = courseFilePath(test.dataDir, CourseId.parse('bio'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    const reply = await askBio(test);
    expect(reply.status).toBe(500);
    expect(reply.json).toEqual({ status: 'internal-error' });
    expect(test.logs).toEqual([
      { operation: 'POST /courses/bio/ask', courseId: '', outcome: 'Error' },
    ]);
  });
});
