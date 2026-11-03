import type { ChatRequest, ChatResult, Generator, ModelGateway } from '@cram/gateway';
import { openCourse } from '@cram/index';
import { rmSync } from 'node:fs';
import { CourseId, LectureId, SourceId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { courseFilePath } from './data-directory';
import { tagStored, taggingLogOutcome } from './fact-tagging';
import { markOlder, seededDataDir } from './repair-fixture';
import {
  gatewayOf,
  PDF,
  pdfDeck,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './server-fixture';
import { embedderIdentity } from './slide-embedding';

const QUEEN = ['The queen', 'One queen per colony'];
const SWARM = ['Swarming', 'Swarm watch begins when the bloom count passes forty'];
const READING = ['References', 'Hollowmere Guild handbook, 1890'];
const BIO = CourseId.parse('bio');

type Topics = (passage: string) => ChatResult<unknown>;

const PassageBlock = z.strictObject({ lecture: z.string(), passage: z.string() });

/** Answers each tag call from its passage, after `gate`; every other call goes to `inner`. */
const tagging = (
  inner: ModelGateway,
  topics: Topics,
  passages: string[] = [],
  gate: Promise<void> = Promise.resolve(),
): ModelGateway => {
  const generator: Generator = {
    ...inner.generator,
    chat: async <T>(request: ChatRequest<T>): Promise<ChatResult<T>> => {
      if (request.output.name !== 'topic-tags') return inner.generator.chat(request);
      const { passage } = PassageBlock.parse(JSON.parse(request.messages[1]?.content ?? ''));
      passages.push(passage);
      await gate;
      const reply = topics(passage);
      return reply.status === 'completed'
        ? { status: 'completed', value: request.output.schema.parse(reply.value) }
        : reply;
    },
  };
  return { ...inner, generator };
};

const named: Topics = (passage) => ({
  status: 'completed',
  value: {
    tags: passage.includes('queen') ? ['the queen', ' castes '] : ['swarming', 'bloom count'],
  },
});

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const started = async (gateway: ModelGateway): Promise<TestServer> => {
  test = await startTestServer(gateway);
  return test;
};

const upload = async ({ server }: TestServer, bytes: Uint8Array, lectureId = 'l1') => {
  await send(server.port, {
    method: 'POST',
    path: `/courses/bio/decks?${new URLSearchParams({ lectureId, fileName: 'hive.pdf' }).toString()}`,
    headers: { 'content-type': PDF },
    body: bytes,
  });
  return (await settledStatus(server.port, 'bio')).json as {
    uploads: { progress: { state: string } }[];
  };
};

/** Each stored slide's tag rows, read back from the course file. */
const storedTags = async ({ dataDir }: TestServer, sourceIds: readonly string[]) => {
  const opened = openCourse({
    path: courseFilePath(dataDir, BIO),
    courseId: BIO,
    embedder: await embedderIdentity(gatewayOf([]).embedder),
  });
  if (opened.status !== 'open') throw new Error(`course file not open: ${opened.status}`);
  try {
    return sourceIds.map((id) => opened.course.topics(SourceId.parse(id)));
  } finally {
    opened.course.close();
  }
};

describe('the tag pass at upload', () => {
  it('stores each chunk’s tags as the tagger’s before the upload reads indexed, skipping a references slide', async () => {
    const bytes = await pdfDeck([QUEEN, SWARM, READING, []]);
    const passages: string[] = [];
    const server = await started(tagging(gatewayOf([]), named, passages));
    const { uploads } = await upload(server, bytes);
    expect(uploads.map(({ progress }) => progress.state)).toEqual(['indexed']);
    expect(await storedTags(server, ['l1/1', 'l1/2', 'l1/3', 'l1/4'])).toEqual([
      [
        { chunkNo: 1, origin: 'tagger', tag: 'castes' },
        { chunkNo: 1, origin: 'tagger', tag: 'the queen' },
      ],
      [
        { chunkNo: 1, origin: 'tagger', tag: 'bloom count' },
        { chunkNo: 1, origin: 'tagger', tag: 'swarming' },
      ],
      [],
      [],
    ]);
    expect(passages).toHaveLength(2);
    expect(passages.some((passage) => passage.includes('Hollowmere'))).toBe(false);
    expect(server.logs).toEqual([]);
  });

  it('leaves a chunk whose reply is invalid untagged, keeps the upload indexed and logs a count, never a tag', async () => {
    const bytes = await pdfDeck([QUEEN, SWARM]);
    const server = await started(
      tagging(gatewayOf([]), (passage) =>
        passage.includes('queen')
          ? { status: 'invalid-output', content: 'the queen', issue: 'not JSON' }
          : named(passage),
      ),
    );
    const { uploads } = await upload(server, bytes);
    expect(uploads.map(({ progress }) => progress.state)).toEqual(['indexed']);
    const [queen, swarm] = await storedTags(server, ['l1/1', 'l1/2']);
    expect(queen).toEqual([]);
    expect(swarm?.map(({ tag }) => tag)).toEqual(['bloom count', 'swarming']);
    expect(server.logs).toEqual([
      {
        operation: 'tag',
        courseId: 'bio',
        lectureId: 'l1',
        outcome: 'untagged 1/2 invalid-output',
      },
    ]);
  });

  it('names each reason once, sorted, when a pass both fails a reply and stops at a backend failure', async () => {
    const bytes = await pdfDeck([QUEEN, SWARM, ['The stilling', 'Bees sleep through the winter']]);
    const server = await started(
      tagging(gatewayOf([]), (passage) =>
        passage.includes('queen')
          ? { status: 'invalid-output', content: 'x', issue: 'not JSON' }
          : { status: 'backend-failed', reason: 'connection refused' },
      ),
    );
    await upload(server, bytes);
    expect(server.logs).toEqual([
      {
        operation: 'tag',
        courseId: 'bio',
        lectureId: 'l1',
        outcome: 'untagged 3/3 backend-failed,invalid-output',
      },
    ]);
  });

  it('reads ingesting while a tag call is out, and indexed only once the pass is done', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const passages: string[] = [];
    const server = await started(tagging(gatewayOf([]), named, passages, gate));
    const sent = send(server.server.port, {
      method: 'POST',
      path: `/courses/bio/decks?${new URLSearchParams({ lectureId: 'l1', fileName: 'hive.pdf' }).toString()}`,
      headers: { 'content-type': PDF },
      body: await pdfDeck([QUEEN]),
    });
    while (passages.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const during = (await send(server.server.port, { method: 'GET', path: '/courses/bio/ingest' }))
      .json as { uploads: { progress: { state: string } }[] };
    expect(during.uploads.map(({ progress }) => progress.state)).toEqual(['ingesting']);
    release();
    await sent;
    const settled = (await settledStatus(server.server.port, 'bio')).json as typeof during;
    expect(settled.uploads.map(({ progress }) => progress.state)).toEqual(['indexed']);
  });

  it('counts only the chunks it asked about, leaving a text-less one out of the log', async () => {
    const bytes = await pdfDeck([QUEEN, SWARM, []]);
    const server = await started(
      tagging(gatewayOf([]), (passage) =>
        passage.includes('queen')
          ? { status: 'invalid-output', content: 'x', issue: 'not JSON' }
          : named(passage),
      ),
    );
    await upload(server, bytes);
    expect(server.logs).toEqual([
      {
        operation: 'tag',
        courseId: 'bio',
        lectureId: 'l1',
        outcome: 'untagged 1/2 invalid-output',
      },
    ]);
  });

  it('keeps the upload indexed when the tag pass throws, logging it by name', async () => {
    const bytes = await pdfDeck([QUEEN]);
    const server = await started(
      tagging(gatewayOf([]), () => {
        throw new RangeError('broken');
      }),
    );
    const { uploads } = await upload(server, bytes, 'l7');
    expect(uploads.map(({ progress }) => progress.state)).toEqual(['indexed']);
    expect(await storedTags(server, ['l7/1'])).toEqual([[]]);
    expect(server.logs).toEqual([
      { operation: 'tag', courseId: 'bio', lectureId: 'l7', outcome: 'RangeError' },
    ]);
  });

  it('replaces a lecture’s tags when it is uploaded again', async () => {
    const server = await started(tagging(gatewayOf([]), named));
    await upload(server, await pdfDeck([QUEEN, SWARM]));
    await upload(server, await pdfDeck([SWARM]));
    expect(await storedTags(server, ['l1/1'])).toEqual([
      [
        { chunkNo: 1, origin: 'tagger', tag: 'bloom count' },
        { chunkNo: 1, origin: 'tagger', tag: 'swarming' },
      ],
    ]);
  });

  it('reports a course file it cannot open as unavailable, calling nothing', async () => {
    const dataDir = await seededDataDir([QUEEN]);
    markOlder(dataDir);
    const calls: string[] = [];
    const gateway = tagging(gatewayOf([]), named, calls);
    const files = { dataDir, embedder: await embedderIdentity(gateway.embedder) };
    const outcome = await tagStored(BIO, LectureId.parse('l1'), { files, gateway });
    rmSync(dataDir, { recursive: true, force: true });
    expect(outcome).toEqual({ status: 'course-unavailable', problem: 'older-schema' });
    expect(taggingLogOutcome(outcome)).toBe('course-unavailable');
    expect(calls).toEqual([]);
  });
});
