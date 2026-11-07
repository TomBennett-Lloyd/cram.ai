import type { EmbedRequest, Embedder, EmbeddingResult, Recording } from '@cram/gateway';
import { ASK_TURN_WINDOW } from '@cram/grounding';
import type * as IndexModule from '@cram/index';
import type { AskTurn, RetrievedSlide } from '@cram/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  explained,
  explanationReply,
  gatewayOf,
  marked,
  pdfDeck,
  type Received,
  retrievedFrom,
  rewritten,
  send,
  settledStatus,
  ShortEmbedder,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
  WordEmbedder,
} from './server-fixture';

/** Every course file the server opens to read, so a test can see a failed rewrite opened none. */
const readers = vi.hoisted(() => ({ opened: 0 }));
vi.mock('@cram/index', async (original) => {
  const actual = await original<typeof IndexModule>();
  return {
    ...actual,
    openCourseReadOnly: (...args: Parameters<typeof actual.openCourseReadOnly>) => {
      const opened = actual.openCourseReadOnly(...args);
      if (opened.status === 'open') readers.opened += 1;
      return opened;
    },
  };
});

const QUESTION = 'Who are the workers?';
const FOLLOW_UP = 'And the drones?';
const STANDALONE = 'What are the drones?';
const HIVE = [['The Hive', 'Worker bees are male in this course.']];
const ENTAILED = {
  status: 'scored',
  scores: { entailment: 0.9, neutral: 0.05, contradiction: 0.05 },
} as const;
const ANSWER = 'Drones are male.';
const standaloneReply = (value: { readonly question: string }) =>
  ({ status: 'content', content: JSON.stringify(value) }) as const;
const TURNS: AskTurn[] = [{ question: QUESTION, answer: 'Workers are male in this course.' }];

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

class SpyEmbedder extends WordEmbedder {
  readonly embedded: string[] = [];
  override embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    this.embedded.push(...request.texts);
    return super.embed(request);
  }
}

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
  readers.opened = 0;
  return test;
};

const askBio = ({ server }: TestServer, question: string, turns: AskTurn[]): Promise<Received> =>
  send(server.port, {
    method: 'POST',
    path: '/courses/bio/ask',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, turns }),
  });

/** The follow-up answered from `retrieved` with `turns` carried, its one sentence marked. */
const followUpReplies = (retrieved: readonly RetrievedSlide[], turns: readonly AskTurn[]) => [
  explained(FOLLOW_UP, retrieved, explanationReply(ANSWER), [], turns),
  marked([{ text: ANSWER, slides: retrieved }], ENTAILED),
];

const askLogs = ({ logs }: TestServer) =>
  logs.filter(({ operation }) => operation.startsWith('ask '));

/** `docs/adr/0011-ask-conversation.md` § Decision (b)–(e). */
describe('POST /courses/:id/ask, a follow-up', () => {
  it('retrieves on the standalone rewrite and answers the typed question with the turns', async () => {
    const spy = new SpyEmbedder();
    const server = await hiveCourse(
      (retrieved) => [
        rewritten(FOLLOW_UP, TURNS, standaloneReply({ question: STANDALONE })),
        ...followUpReplies(retrieved, TURNS),
      ],
      spy,
    );
    spy.embedded.length = 0;
    const reply = await askBio(server, FOLLOW_UP, TURNS);
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      status: 'grounded',
      explanation: { text: ANSWER },
      searched: STANDALONE,
    });
    expect(spy.embedded).toEqual([STANDALONE, ANSWER]);
    const [rewrite, context, ...rest] = askLogs(server);
    expect(rewrite).toEqual({ operation: 'ask rewrite', courseId: 'bio', outcome: 'rewritten' });
    expect(context?.operation).toBe('ask context');
    expect(context?.outcome).toMatch(/, 1 turns carried, 0 turns dropped$/);
    expect(rest).toEqual([]);
  });

  it('carries the newest ASK_TURN_WINDOW turns and counts the rest as dropped', async () => {
    const thread = Array.from({ length: ASK_TURN_WINDOW + 1 }, (_, at) => ({
      question: `Question ${String(at)}?`,
      answer: `Answer ${String(at)}.`,
    }));
    const carried = thread.slice(1);
    const server = await hiveCourse((retrieved) => [
      rewritten(FOLLOW_UP, carried, standaloneReply({ question: STANDALONE })),
      ...followUpReplies(retrieved, carried),
    ]);
    const reply = await askBio(server, FOLLOW_UP, thread);
    expect(reply.status).toBe(200);
    expect(askLogs(server).at(-1)?.outcome).toMatch(
      new RegExp(`, ${String(ASK_TURN_WINDOW)} turns carried, 1 turns dropped$`),
    );
  });

  it('answers 502 for a rewrite the model botched, before opening the course', async () => {
    const server = await hiveCourse(() => [
      rewritten(FOLLOW_UP, TURNS, { status: 'content', content: '{"question":" "}' }),
    ]);
    const reply = await askBio(server, FOLLOW_UP, TURNS);
    expect(reply.status).toBe(502);
    expect(reply.json).toEqual({ status: 'model-failed' });
    expect(askLogs(server)).toEqual([
      { operation: 'ask rewrite', courseId: 'bio', outcome: 'invalid-output' },
    ]);
    expect(readers.opened).toBe(0);
  });

  it('retrieves on the typed question when the embedder refuses the rewrite as over-length', async () => {
    const long = 'What do the drones of the hive do all day?';
    const server = await hiveCourse(
      (retrieved) => [
        rewritten(FOLLOW_UP, TURNS, standaloneReply({ question: long })),
        ...followUpReplies(retrieved, TURNS),
      ],
      new ShortEmbedder(4),
    );
    const reply = await askBio(server, FOLLOW_UP, TURNS);
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ status: 'grounded', explanation: { text: ANSWER } });
    expect(reply.json).not.toHaveProperty('searched');
    expect(askLogs(server)[0]).toEqual({
      operation: 'ask rewrite',
      courseId: 'bio',
      outcome: 'over-length',
    });
  });

  it('asks a question with no turns exactly as a new thread, with no rewrite', async () => {
    const server = await hiveCourse((retrieved) => followUpReplies(retrieved, []));
    const reply = await askBio(server, FOLLOW_UP, []);
    expect(reply.status).toBe(200);
    expect(askLogs(server).map(({ operation }) => operation)).toEqual(['ask context']);
  });
});
