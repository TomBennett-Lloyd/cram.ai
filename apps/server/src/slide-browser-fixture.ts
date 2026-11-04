import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { textHashOf } from '@cram/index';
import { ChunkNo, CourseId, LectureSlides, SourceId, TopicTag } from '@cram/shared';
import { courseFilePath } from './data-directory';
import { openedUnder, stopRestarted, uploadTo } from './repair-fixture';
import {
  pdfDeck,
  type Received,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  type TestServer,
  WordEmbedder,
} from './server-fixture';

export const QUEEN = ['The queen', 'One queen per colony', 'She lays every egg'];
export const SWARM = ['Swarming', 'Swarm watch begins when the bloom count passes forty'];

/** The hash `textHashOf` gives a one-chunk slide `pdfDeck` draws from `page`: its first line the title, the rest the body. */
export const pageHash = (page: readonly string[]): string =>
  textHashOf({
    title: page[0] ?? '',
    body: page.slice(1).join('\n'),
    speakerNotes: '',
    imageCaptions: [],
  });

export const FACT = { sourceId: 'l1/1', chunkNo: 1 };
export const FIRST = { ...FACT, textHash: pageHash(QUEEN) };
export const SECOND = { sourceId: 'l1/2', chunkNo: 1, textHash: pageHash(SWARM) };
/** QUEEN's chunk's list as `hive` stores it and the GET serves it. */
export const HELD = [
  { tag: 'castes', origin: 'student' },
  { tag: 'the queen', origin: 'tagger' },
];
export const EDIT = { ...FIRST, base: HELD };

let started: TestServer | undefined;

export const startServer = async (): Promise<TestServer> => {
  started = await startTestServer();
  return started;
};

export const forgetStarted = (): void => {
  started = undefined;
};

export const stopStarted = async (): Promise<void> => {
  if (started !== undefined) await stopTestServer(started);
  started = undefined;
  await stopRestarted();
};

/** A `bio` course holding QUEEN and SWARM as lecture `l1`, QUEEN's chunk tagged by the tagger and the student. */
export const hive = async (): Promise<TestServer> => {
  const test = await startServer();
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

export const slides = (port: number, query: string, courseId = 'bio'): Promise<Received> =>
  send(port, { method: 'GET', path: `/courses/${courseId}/slides${query}` });

export const lecture = (port: number) => slides(port, '?lectureId=l1');

export const put = (port: number, body: unknown, courseId = 'bio', type = 'application/json') =>
  send(port, {
    method: 'PUT',
    path: `/courses/${courseId}/tags`,
    headers: { 'content-type': type },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

export const firstChunkTags = (received: Received) =>
  LectureSlides.parse(received.json).slides[0]?.chunks[0]?.tags;

export const brokenCourseFile = (dataDir: string, content: string): void => {
  const path = courseFilePath(dataDir, CourseId.parse('bio'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
