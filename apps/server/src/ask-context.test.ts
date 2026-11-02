import type * as IndexModule from '@cram/index';
import {
  explanationRequest,
  PROMPT_CHARS_PER_TOKEN,
  PROMPT_TOKEN_BUDGET,
  requestTokens,
} from '@cram/grounding';
import { LectureSummary, type LoadedSummary, type RetrievedSlide } from '@cram/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  explained,
  explanationReply,
  gatewayOf,
  marked,
  pdfDeck,
  retrievedFrom,
  send,
  settledStatus,
  startTestServer,
  stopTestServer,
  type TestServer,
  uploadPath,
} from './server-fixture';

/** Summaries a test loads in place of the course file's, so one can overflow the prompt budget. */
const loading = vi.hoisted(() => ({
  summaries: undefined as readonly LoadedSummary[] | undefined,
}));
vi.mock('@cram/index', async (original) => {
  const actual = await original<typeof IndexModule>();
  return {
    ...actual,
    loadSummaries: (...args: Parameters<typeof actual.loadSummaries>) =>
      loading.summaries ?? actual.loadSummaries(...args),
  };
});

const QUESTION = 'Who are the workers?';
const SENTENCE = 'Workers are male in this course.';
const ENTAILED = {
  status: 'scored',
  scores: { entailment: 0.9, neutral: 0.05, contradiction: 0.05 },
} as const;

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
  loading.summaries = undefined;
});

/** A summary of `slide`'s lecture longer than the whole prompt budget, so assembly drops it. */
const overBudget = ({ sourceId, record }: RetrievedSlide): LectureSummary =>
  LectureSummary.parse({
    lectureId: record.lectureId,
    units: [
      {
        text: 'Bees. '.repeat(Math.ceil((PROMPT_TOKEN_BUDGET * PROMPT_CHARS_PER_TOKEN) / 5)),
        citations: [{ sourceId, quote: record.body }],
        kind: 'lecture-summary',
      },
    ],
  });

/** The `bio` course holding the hive deck, asked with `summaries` loaded in place of its own. */
const asked = async (summaries: (retrieved: RetrievedSlide[]) => readonly LoadedSummary[]) => {
  const deck = await pdfDeck([['The Hive', 'Worker bees are male in this course.']]);
  const retrieved = await retrievedFrom(deck, 'bio', 'l1', 'hive.pdf');
  test = await startTestServer(
    gatewayOf([
      explained(QUESTION, retrieved, explanationReply(SENTENCE)),
      marked([{ text: SENTENCE, slides: retrieved }], ENTAILED),
    ]),
  );
  const { port } = test.server;
  await send(port, {
    method: 'POST',
    path: uploadPath('bio', 'l1', 'hive.pdf'),
    headers: { 'content-type': 'application/pdf' },
    body: deck,
  });
  await settledStatus(port, 'bio');
  loading.summaries = summaries(retrieved);
  const reply = await send(port, {
    method: 'POST',
    path: '/courses/bio/ask',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: QUESTION }),
  });
  return { reply, retrieved, logs: test.logs };
};

/** The line each ask with a retrieved slide logs: counts, never text. */
const contextLine = (retrieved: readonly RetrievedSlide[], leftOut: number) => ({
  operation: 'ask context',
  courseId: 'bio',
  outcome: `${String(requestTokens(explanationRequest(QUESTION, { raw: retrieved, summaries: [] })))} prompt tokens, ${String(leftOut)} left out`,
});

describe('POST /courses/:id/ask, the prompt’s context', () => {
  it('sends what the prompt budget left out, and logs the prompt’s size and that count', async () => {
    const { reply, retrieved, logs } = await asked((slides) =>
      slides.slice(0, 1).map((slide) => ({ summary: overBudget(slide), slides: [slide] })),
    );
    expect(reply.json).toMatchObject({
      status: 'grounded',
      leftOut: retrieved.map(({ sourceId }) => sourceId),
    });
    expect(logs).toEqual([contextLine(retrieved, retrieved.length)]);
  });

  it('leaves nothing out when the context fits', async () => {
    const { reply, retrieved, logs } = await asked(() => []);
    expect(reply.json).toMatchObject({ status: 'grounded', leftOut: [] });
    expect(logs).toEqual([contextLine(retrieved, 0)]);
  });
});
