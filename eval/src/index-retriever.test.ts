import type { Embedder } from '@cram/gateway';
import { CourseId, Deck, embedText, type SlideRecord } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { IndexRetriever, type IndexRetrieverSpec } from './index-retriever';
import { record } from './run-fixture';
import { ScriptedGateway } from './scripted-gateway-fixture';

const deck = Deck.parse({
  lectureId: 'l1',
  lectureTitle: 'Lecture l1',
  mediaType: 'application/pdf',
  content: new TextEncoder().encode('deck l1'),
});

const SLIDES = [
  record({ slideNo: 1, body: 'Bees build comb from square cells.' }),
  record({ slideNo: 2, body: 'Worker bees are male.' }),
  record({ slideNo: 3, body: 'Foragers see red best.' }),
];

const { embedder } = new ScriptedGateway(() => ({ status: 'backend-failed', reason: 'unused' }));

const spec = (overrides: Partial<IndexRetrieverSpec> = {}): IndexRetrieverSpec => ({
  courseId: CourseId.parse('hollowmere'),
  lectures: [{ deck, slides: SLIDES }],
  embedder,
  k: 2,
  ...overrides,
});

const open = (slides: readonly SlideRecord[], k = 2) =>
  IndexRetriever.open(spec({ lectures: [{ deck, slides }], k }));

describe('IndexRetriever', () => {
  it('returns at most k slides, nearest first', async () => {
    const retriever = await open(SLIDES);
    const hits = await retriever.retrieve('Are worker bees male?');
    retriever.close();
    expect(hits.map(({ record: slide }) => slide.slideNo)).toEqual([2, 1]);
  });

  it('embeds each slide as its embedText, the text ingest embeds it as', async () => {
    const slides = [
      record({ slideNo: 1, speakerNotes: 'Drones are male.', imageCaptions: ['A comb'] }),
      record({ slideNo: 2, title: ' ', body: 'Foragers see red best.' }),
    ];
    const sent: string[][] = [];
    const spy: Embedder = {
      pin: embedder.pin,
      embed: (request) => {
        sent.push([...request.texts]);
        return embedder.embed(request);
      },
    };
    (await IndexRetriever.open(spec({ lectures: [{ deck, slides }], embedder: spy }))).close();
    expect(sent).toEqual([slides.map(embedText)]);
  });

  it('refuses a course with no slide', async () => {
    await expect(open([])).rejects.toThrow('the course has no slide');
  });

  it('refuses a slide over the embedder’s input length rather than indexing it truncated', async () => {
    const overLength: Embedder = {
      pin: embedder.pin,
      embed: async (request) => {
        const results = await embedder.embed(request);
        return results.map((result, index) =>
          index === 1 ? { status: 'over-length', inputTokens: 600, maxInputTokens: 512 } : result,
        );
      },
    };
    await expect(IndexRetriever.open(spec({ embedder: overLength }))).rejects.toThrow(
      "text 1 is 600 tokens, over the embedder's 512",
    );
  });

  it('refuses an embedder that returns a different number of results than texts', async () => {
    const short: Embedder = {
      pin: embedder.pin,
      embed: async (request) => (await embedder.embed(request)).slice(1),
    };
    await expect(IndexRetriever.open(spec({ embedder: short }))).rejects.toThrow(
      'returned 2 results for 3 texts',
    );
  });
});
