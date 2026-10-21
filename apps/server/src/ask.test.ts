import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Recording } from '@cram/gateway';
import { slideLines } from '@cram/grounding';
import { CourseId, type RetrievedSlide } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import { MAX_ASK_BYTES } from './handlers';
import {
  answer,
  cite,
  FailingEmbedder,
  ShortEmbedder,
  gatewayOf,
  generated,
  judged,
  pdfDeck,
  type Received,
  retrievedFrom,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
} from './server-fixture';

const QUESTION = 'Who are the workers?';
const HIVE = [['The Hive', 'Worker bees are male in this course.']];
const ENTAILED = {
  status: 'scored',
  scores: { entailment: 0.9, neutral: 0.05, contradiction: 0.05 },
} as const;
const CONTRADICTED = {
  status: 'scored',
  scores: { entailment: 0.05, neutral: 0.05, contradiction: 0.9 },
} as const;

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

/** A server whose `bio` course holds the hive deck, with `recordings` built from what it retrieves. */
const hiveCourse = async (
  recordings: (retrieved: RetrievedSlide[]) => readonly Recording[],
): Promise<TestServer> => {
  const deck = await pdfDeck(HIVE);
  const retrieved = await retrievedFrom(deck, 'bio', 'l1', 'hive.pdf');
  test = await startTestServer(gatewayOf(recordings(retrieved)));
  await send(test.server.port, {
    method: 'POST',
    path: uploadPath('bio', 'l1', 'hive.pdf'),
    headers: { 'content-type': 'application/pdf' },
    body: deck,
  });
  await settledStatus(test.server.port, 'bio');
  return test;
};

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

const male = cite('l1/1', 'Worker bees are male in this course.');
const unit = answer('Workers are male in this course.', [male]);

/** The model's reply for `unit`: each quote written as the number of the retrieved line it is. */
const unitReply = (retrieved: readonly RetrievedSlide[]) =>
  generated(QUESTION, retrieved, {
    status: 'content',
    content: JSON.stringify({
      units: [
        {
          text: unit.text,
          citations: unit.citations.map(({ sourceId, quote }) => {
            const slide = retrieved.find((candidate) => candidate.sourceId === sourceId);
            const line = slide === undefined ? [] : slideLines(slide.record);
            return { sourceId, line: line.indexOf(quote) + 1 };
          }),
        },
      ],
    }),
  });

describe('POST /courses/:id/ask', () => {
  it('answers with the verified units, their citations and the retrieved slides', async () => {
    let slides: RetrievedSlide[] = [];
    const server = await hiveCourse((retrieved) => {
      slides = retrieved;
      return [unitReply(retrieved), judged(unit, ENTAILED)];
    });
    const reply = await askBio(server);
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ status: 'grounded', shown: [unit], withheld: [], slides });
  });

  it('answers not-covered with the withheld unit and the closest slides when nothing survives', async () => {
    let slides: RetrievedSlide[] = [];
    const server = await hiveCourse((retrieved) => {
      slides = retrieved;
      return [unitReply(retrieved), judged(unit, CONTRADICTED)];
    });
    const reply = await askBio(server);
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({
      status: 'not-covered',
      withheld: [{ reason: 'unsupported', unit }],
      slides,
    });
  });

  it('never sends the student a model’s unparsed output', async () => {
    const raw = 'Worker bees are female, as everyone knows.';
    const server = await hiveCourse((retrieved) => [
      generated(QUESTION, retrieved, { status: 'content', content: raw }),
    ]);
    const reply = await askBio(server);
    expect(reply.status).toBe(502);
    expect(reply.json).toEqual({ status: 'model-failed' });
    expect(server.logs).toEqual([
      { operation: 'ask generate', courseId: 'bio', outcome: 'invalid-output' },
    ]);
  });

  it('answers 502 when the generator backend fails', async () => {
    const server = await hiveCourse((retrieved) => [
      generated(QUESTION, retrieved, { status: 'backend-failed', reason: 'connection refused' }),
    ]);
    const reply = await askBio(server);
    expect(reply.status).toBe(502);
    expect(reply.json).toEqual({ status: 'model-failed' });
  });

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
    expect(reply.json).toEqual({ status: 'not-covered', withheld: [], slides: [] });
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
