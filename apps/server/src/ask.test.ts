import type { EmbedRequest, Embedder, EmbeddingResult, Recording } from '@cram/gateway';
import type * as IndexModule from '@cram/index';
import type { RetrievedSlide } from '@cram/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  explained,
  explanationReply,
  gatewayOf,
  marked,
  pdfDeck,
  type Received,
  retrievedFrom,
  send,
  settledStatus,
  ShortEmbedder,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
  WordEmbedder,
} from './server-fixture';

/** Every course file the server opens to read, so a test can see that Ask closed its own. */
const readers = vi.hoisted(() => ({ open: 0, searches: 0 }));
vi.mock('@cram/index', async (original) => {
  const actual = await original<typeof IndexModule>();
  return {
    ...actual,
    openCourseReadOnly: (...args: Parameters<typeof actual.openCourseReadOnly>) => {
      const opened = actual.openCourseReadOnly(...args);
      if (opened.status !== 'open') return opened;
      readers.open += 1;
      const { course } = opened;
      const close = course.close.bind(course);
      const search = course.search.bind(course);
      return {
        ...opened,
        course: Object.assign(course, {
          close: () => {
            readers.open -= 1;
            close();
          },
          search: (...query: Parameters<typeof search>) => {
            readers.searches += 1;
            return search(...query);
          },
        }),
      };
    },
  };
});

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
const SENTENCE = 'Workers are male in this course.';

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

/** A server whose `bio` course holds the hive deck, with `recordings` built from what it retrieves. */
const hiveCourse = async (
  recordings: (retrieved: RetrievedSlide[]) => readonly Recording[],
  embedder: Embedder = new WordEmbedder(),
): Promise<TestServer> => {
  const deck = await pdfDeck(HIVE);
  const retrieved = await retrievedFrom(deck, 'bio', 'l1', 'hive.pdf');
  test = await startTestServer(gatewayOf(recordings(retrieved), embedder));
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

/** The explanation `text` of `question`, and the mark over each of its sentences against the one hive slide. */
const hiveReplies = (
  retrieved: readonly RetrievedSlide[],
  text: string = SENTENCE,
  question: string = QUESTION,
  result: typeof ENTAILED | typeof CONTRADICTED = ENTAILED,
): Recording[] => [
  explained(question, retrieved, explanationReply(text)),
  marked(
    text.split(/(?<=\.) /).map((sentence) => ({ text: sentence, slides: retrieved })),
    result,
  ),
];

class SpyEmbedder extends WordEmbedder {
  readonly embedded: string[] = [];
  override embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    this.embedded.push(...request.texts);
    return super.embed(request);
  }
}

const sentenceOf = (
  text: string,
  slides: readonly RetrievedSlide[],
  contradicts: string[] = [],
) => ({
  text,
  slides: slides.map(({ sourceId }) => sourceId),
  contradicts,
});

describe('POST /courses/:id/ask', () => {
  it('answers with the whole explanation, each sentence’s slides, and the slides it names', async () => {
    let slides: RetrievedSlide[] = [];
    const server = await hiveCourse((retrieved) => {
      slides = retrieved;
      return hiveReplies(retrieved);
    });
    const reply = await askBio(server);
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({
      status: 'grounded',
      explanation: {
        text: SENTENCE,
        quotes: [],
        sentences: [sentenceOf(SENTENCE, slides)],
        sources: slides.map(({ sourceId }) => sourceId),
      },
      withheld: [],
      slides,
      leftOut: [],
    });
  });

  it('marks a sentence its slide contradicts, and shows it', async () => {
    let slides: RetrievedSlide[] = [];
    const server = await hiveCourse((retrieved) => {
      slides = retrieved;
      return hiveReplies(retrieved, SENTENCE, QUESTION, CONTRADICTED);
    });
    const reply = await askBio(server);
    const ids = slides.map(({ sourceId }) => sourceId);
    expect(reply.json).toMatchObject({
      status: 'grounded',
      explanation: { text: SENTENCE, sentences: [sentenceOf(SENTENCE, slides, ids)] },
    });
  });

  it('searches the course once per sentence, then closes it', async () => {
    const spy = new SpyEmbedder();
    const two = `${SENTENCE} Drones are not covered here.`;
    const server = await hiveCourse((retrieved) => hiveReplies(retrieved, two), spy);
    spy.embedded.length = 0;
    readers.searches = 0;
    const reply = await askBio(server);
    expect(reply.json).toMatchObject({ status: 'grounded', explanation: { text: two } });
    expect(spy.embedded).toEqual([QUESTION, SENTENCE, 'Drones are not covered here.']);
    expect(readers.searches).toBe(3);
    expect(readers.open).toBe(0);
  });

  it('gives a sentence longer than the embedder takes no candidates, and attributes the rest', async () => {
    const long = 'Drones are not covered anywhere in this hive deck.';
    let slides: RetrievedSlide[] = [];
    const server = await hiveCourse((retrieved) => {
      slides = retrieved;
      return [
        explained(QUESTION, retrieved, explanationReply(`${SENTENCE} ${long}`)),
        marked([{ text: SENTENCE, slides: retrieved }], ENTAILED),
      ];
    }, new ShortEmbedder(7));
    const reply = await askBio(server);
    expect(reply.json).toMatchObject({
      status: 'grounded',
      explanation: { sentences: [sentenceOf(SENTENCE, slides), sentenceOf(long, [])] },
    });
  });

  it('retrieves on the corrected question, names it in the reply, and generates on the typed one', async () => {
    const typed = 'Who are the wroker bees?';
    const spy = new SpyEmbedder();
    let slides: RetrievedSlide[] = [];
    const server = await hiveCourse((retrieved) => {
      slides = retrieved;
      return hiveReplies(retrieved, SENTENCE, typed);
    }, spy);
    spy.embedded.length = 0;
    const reply = await askBio(server, JSON.stringify({ question: typed }));
    expect(reply.json).toMatchObject({
      status: 'grounded',
      slides,
      searched: 'Who are the worker bees?',
    });
    expect(spy.embedded[0]).toBe('Who are the worker bees?');
  });

  it('ranks on the corrected question in the keyword list as well as the vector list', async () => {
    const typed = 'What do wrokers do?';
    class TitleEmbedder extends WordEmbedder {
      override embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
        return Promise.resolve(
          request.texts.map((text) => {
            const vector = new Float32Array(8);
            vector[text.includes('Worker') ? 1 : 0] = 1;
            return { status: 'embedded', vector };
          }),
        );
      }
    }
    const deck = await pdfDeck([
      ['Drones', 'Drones keep the brood warm'],
      ['Workers', 'Worker bees forage'],
    ]);
    const [drones, workers] = await retrievedFrom(deck, 'bio', 'l1', 'hive.pdf');
    if (drones === undefined || workers === undefined) throw new Error('two slides expected');
    const expected = [workers, drones];
    test = await startTestServer(
      gatewayOf(
        [
          explained(typed, expected, explanationReply('Workers forage.')),
          marked([{ text: 'Workers forage.', slides: expected }], ENTAILED),
        ],
        new TitleEmbedder(),
      ),
    );
    await send(test.server.port, {
      method: 'POST',
      path: uploadPath('bio', 'l1', 'hive.pdf'),
      headers: { 'content-type': 'application/pdf' },
      body: deck,
    });
    await settledStatus(test.server.port, 'bio');
    const reply = await askBio(test, JSON.stringify({ question: typed }));
    expect(reply.json).toMatchObject({
      status: 'grounded',
      slides: expected,
      searched: 'What do workers do?',
    });
  });

  it('answers not-covered with the closest slides, naming the corrected question, when the model finds nothing', async () => {
    const typed = 'Who are the wroker bees?';
    let slides: RetrievedSlide[] = [];
    const server = await hiveCourse((retrieved) => {
      slides = retrieved;
      return [explained(typed, retrieved, { status: 'content', content: '{"answer":null}' })];
    });
    const reply = await askBio(server, JSON.stringify({ question: typed }));
    expect(reply.json).toEqual({
      status: 'not-covered',
      withheld: [],
      slides,
      leftOut: [],
      searched: 'Who are the worker bees?',
    });
    expect(readers.open).toBe(0);
  });

  it('never sends the student a model’s unparsed output', async () => {
    const raw = 'Worker bees are female, as everyone knows.';
    const server = await hiveCourse((retrieved) => [
      explained(QUESTION, retrieved, { status: 'content', content: raw }),
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
      explained(QUESTION, retrieved, { status: 'backend-failed', reason: 'connection refused' }),
    ]);
    const reply = await askBio(server);
    expect(reply.status).toBe(502);
    expect(reply.json).toEqual({ status: 'model-failed' });
  });
});
