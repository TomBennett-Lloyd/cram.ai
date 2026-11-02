import type { ChatRequest, ChatResult, Generator, ModelGateway } from '@cram/gateway';
import { openCourse } from '@cram/index';
import { CourseId, SourceId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
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

/** Answers each tag call from its passage; every other call goes to `inner`. */
const tagging = (inner: ModelGateway, topics: Topics, passages: string[] = []): ModelGateway => {
  const generator: Generator = {
    ...inner.generator,
    chat: <T>(request: ChatRequest<T>): Promise<ChatResult<T>> => {
      if (request.output.name !== 'topic-tags') return inner.generator.chat(request);
      const { passage } = JSON.parse(request.messages[1]?.content ?? '') as { passage: string };
      passages.push(passage);
      const reply = topics(passage);
      return Promise.resolve(
        reply.status === 'completed'
          ? { status: 'completed', value: request.output.schema.parse(reply.value) }
          : reply,
      );
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
    const bytes = await pdfDeck([QUEEN, SWARM, READING]);
    const passages: string[] = [];
    const server = await started(tagging(gatewayOf([]), named, passages));
    const { uploads } = await upload(server, bytes);
    expect(uploads.map(({ progress }) => progress.state)).toEqual(['indexed']);
    expect(await storedTags(server, ['l1/1', 'l1/2', 'l1/3'])).toEqual([
      [
        { chunkNo: 1, origin: 'tagger', tag: 'castes' },
        { chunkNo: 1, origin: 'tagger', tag: 'the queen' },
      ],
      [
        { chunkNo: 1, origin: 'tagger', tag: 'bloom count' },
        { chunkNo: 1, origin: 'tagger', tag: 'swarming' },
      ],
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
      { operation: 'tag', courseId: 'bio', outcome: 'untagged 1/2 invalid-output' },
    ]);
  });

  it('keeps the upload indexed when the tag pass throws, logging it by name', async () => {
    const bytes = await pdfDeck([QUEEN]);
    const server = await started(
      tagging(gatewayOf([]), () => {
        throw new RangeError('broken');
      }),
    );
    const { uploads } = await upload(server, bytes);
    expect(uploads.map(({ progress }) => progress.state)).toEqual(['indexed']);
    expect(await storedTags(server, ['l1/1'])).toEqual([[]]);
    expect(server.logs).toEqual([{ operation: 'tag', courseId: 'bio', outcome: 'RangeError' }]);
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
});
