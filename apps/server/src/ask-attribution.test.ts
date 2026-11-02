import {
  chatResult,
  type EmbeddingResult,
  type EmbedRequest,
  type EntailRequest,
} from '@cram/gateway';
import { ATTRIBUTION_K, RETRIEVAL_K } from '@cram/index';
import type { RetrievedSlide } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  explained,
  explanationReply,
  gatewayOf,
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

const QUESTION = 'Who are the workers?';
/** A deck's ingest beside every other suite on a loaded machine. */
const INGEST_BOUND_MS = 30_000;
const NEUTRAL = {
  status: 'scored',
  scores: { entailment: 0.1, neutral: 0.8, contradiction: 0.1 },
} as const;

/** Places every text naming drones apart from every other, so the question's retrieval never reaches the drone slide. */
class DroneEmbedder extends WordEmbedder {
  override embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    return Promise.resolve(
      request.texts.map((text) => {
        const vector = new Float32Array(8);
        vector[text.includes('Drones') ? 0 : 1] = 1;
        return { status: 'embedded', vector };
      }),
    );
  }
}

let test: TestServer | undefined;
afterEach(async () => {
  if (test !== undefined) await stopTestServer(test);
  test = undefined;
});

const askBio = ({ server }: TestServer): Promise<Received> =>
  send(server.port, {
    method: 'POST',
    path: '/courses/bio/ask',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: QUESTION }),
  });

describe('POST /courses/:id/ask, attribution', () => {
  it(
    'gives each sentence ATTRIBUTION_K candidates, and names one the question never retrieved',
    async () => {
      const pages = [
        ...Array.from({ length: RETRIEVAL_K + 1 }, (_, n) => [
          `Workers ${String(n)}`,
          `The workers do task ${String(n)}.`,
        ]),
        ['Winter', 'Drones sleep in the frost.'],
      ];
      const deck = await pdfDeck(pages);
      const slides = await retrievedFrom(deck, 'bio', 'l1', 'hive.pdf');
      const drones = slides.at(-1);
      if (drones === undefined) throw new Error('a drone slide');
      const sent: EntailRequest[] = [];
      const sentence = 'Drones sleep in the frost.';
      const base = gatewayOf([], new DroneEmbedder());
      test = await startTestServer({
        ...base,
        generator: {
          pin: base.generator.pin,
          sampling: base.generator.sampling,
          served: base.generator.served,
          chat: (request) =>
            Promise.resolve(chatResult(explanationReply(sentence), request.output.schema)),
        },
        verifier: {
          pin: base.verifier.pin,
          entail: (request) => {
            sent.push(request);
            return Promise.resolve(request.pairs.map(() => NEUTRAL));
          },
        },
      });
      await send(test.server.port, {
        method: 'POST',
        path: uploadPath('bio', 'l1', 'hive.pdf'),
        headers: { 'content-type': 'application/pdf' },
        body: deck,
      });
      await settledStatus(test.server.port, 'bio');
      const reply = await askBio(test);
      expect(sent.map(({ pairs }) => pairs.length)).toEqual([ATTRIBUTION_K]);
      expect(reply.json).toMatchObject({ status: 'grounded' });
      const named = (reply.json as { slides: RetrievedSlide[] }).slides.map(
        ({ sourceId }) => sourceId,
      );
      expect(named.length).toBeGreaterThan(RETRIEVAL_K);
      expect(named).toContain(drones.sourceId);
    },
    INGEST_BOUND_MS,
  );

  it(
    'answers one sentence longer than the embedder takes with the slides it was written from',
    async () => {
      const deck = await pdfDeck([['The Hive', 'Worker bees are male in this course.']]);
      const retrieved = await retrievedFrom(deck, 'bio', 'l1', 'hive.pdf');
      const long = 'Drones are not covered anywhere in this hive deck.';
      test = await startTestServer(
        gatewayOf([explained(QUESTION, retrieved, explanationReply(long))], new ShortEmbedder(7)),
      );
      await send(test.server.port, {
        method: 'POST',
        path: uploadPath('bio', 'l1', 'hive.pdf'),
        headers: { 'content-type': 'application/pdf' },
        body: deck,
      });
      await settledStatus(test.server.port, 'bio');
      const reply = await askBio(test);
      expect(reply.status).toBe(200);
      expect(reply.json).toMatchObject({
        status: 'grounded',
        explanation: {
          sentences: [{ text: long, slides: [] }],
          sources: retrieved.map(({ sourceId }) => sourceId),
        },
      });
    },
    INGEST_BOUND_MS,
  );
});
