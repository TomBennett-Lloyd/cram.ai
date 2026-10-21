import { openCourse } from '@cram/index';
import { CourseId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import {
  gatewayOf,
  PDF,
  pdfDeck,
  send,
  settledStatus,
  ShortEmbedder,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
} from './server-fixture';
import { embedderIdentity, embedQuestion } from './slide-embedding';

// A deck with slides longer than the embedder takes indexes whole, those slides without a vector (#338).

const EMBEDDER = new ShortEmbedder(12);
/** More words than `EMBEDDER` takes. */
const LONG = 'one two three four five six seven eight nine ten eleven twelve thirteen';
const BIO = CourseId.parse('bio');

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const started = async (): Promise<TestServer> => {
  test = await startTestServer(gatewayOf([], EMBEDDER));
  return test;
};

const upload = async ({ server }: TestServer, pages: string[][], lectureId = 'l1') =>
  send(server.port, {
    method: 'POST',
    path: uploadPath('bio', lectureId, `${lectureId}.pdf`),
    headers: { 'content-type': PDF },
    body: await pdfDeck(pages),
  });

const settled = async ({ server }: TestServer) =>
  (await settledStatus(server.port, 'bio')).json as {
    uploads: { progress: unknown }[];
    stored: unknown;
  };

describe('an upload with slides longer than the embedder takes', () => {
  it('indexes a deck whose only over-length slide is its references page whole, and searches as before', async () => {
    const server = await started();
    await upload(server, [
      ['Bees', 'Worker bees guard the hive'],
      ['References', LONG],
    ]);
    const { uploads } = await settled(server);
    expect(uploads.map(({ progress }) => progress)).toEqual([
      { state: 'indexed', slideCount: 2, imageOnly: [], unembedded: [] },
    ]);
    const opened = openCourse({
      path: courseFilePath(server.dataDir, BIO),
      courseId: BIO,
      embedder: await embedderIdentity(EMBEDDER),
    });
    if (opened.status !== 'open') throw new Error(`course file: ${opened.status}`);
    const question = await embedQuestion(EMBEDDER, 'one two three');
    if (question.status !== 'embedded') throw new Error('question did not embed');
    const titles = (includeReferences: boolean) =>
      opened.course
        .search({ text: 'one two three', embedding: question.vector, includeReferences })
        .map(({ record }) => record.title);
    expect(titles(false)).toEqual(['Bees']);
    expect(titles(true)).toEqual(['References', 'Bees']);
    opened.course.close();
  });

  it('leaves out of the vector list only what ingest classes as references, near-misses included', async () => {
    const server = await started();
    await upload(
      server,
      ['References', 'Reference list', 'Further reading', 'Bibliography', 'Referenced work'].map(
        (title) => [title, LONG],
      ),
    );
    const { uploads } = await settled(server);
    expect(uploads.map(({ progress }) => progress)).toEqual([
      { state: 'indexed', slideCount: 5, imageOnly: [], unembedded: [5] },
    ]);
  });

  it('indexes the rest of a deck with a content slide longer than the embedder takes, naming that slide', async () => {
    const server = await started();
    await upload(server, [['Moths', 'Moths fly at night time']]);
    await settled(server);
    await upload(
      server,
      [
        ['Bees', 'Worker bees guard the hive'],
        ['Wasps', LONG],
        ['Ants', 'Ants march in long lines'],
      ],
      'l2',
    );
    const l2 = { slideCount: 3, imageOnly: [], unembedded: [2] };
    const { uploads, stored } = await settled(server);
    expect(uploads.map(({ progress }) => progress)).toEqual([
      { state: 'indexed', slideCount: 1, imageOnly: [], unembedded: [] },
      { state: 'indexed', ...l2 },
    ]);
    expect(stored).toMatchObject({
      lectures: [
        { lectureId: 'l1', unembedded: [] },
        { lectureId: 'l2', ...l2 },
      ],
    });
  });
});
