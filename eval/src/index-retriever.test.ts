import type { Embedder } from '@cram/gateway';
import { CourseId, Deck, embedText, type SlideRecord } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { IndexRetriever, type IndexRetrieverSpec } from './index-retriever';
import { record } from './run-fixture';
import { ScriptedGateway } from './scripted-gateway-fixture';
import { PassageBlock } from './scripted-tutor-fixture';

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

describe('IndexRetriever.searchSentence', () => {
  it('searches a sentence uncorrected at its own k, and finds nothing for one over the embedder’s length', async () => {
    const short: Embedder = {
      pin: embedder.pin,
      embed: async (request) =>
        (await embedder.embed(request)).map((result, index) =>
          (request.texts[index] ?? '').length > 40
            ? { status: 'over-length', inputTokens: 600, maxInputTokens: 512 }
            : result,
        ),
    };
    const retriever = await IndexRetriever.open(spec({ embedder: short }));
    const hits = await retriever.searchSentence('Worker bees are male.', 1);
    const long = await retriever.searchSentence(
      'Worker bees are male, and they build the comb.',
      1,
    );
    retriever.close();
    expect(hits.map(({ record: slide }) => slide.slideNo)).toEqual([2]);
    expect(long).toEqual([]);
  });
});

describe('IndexRetriever', () => {
  it('returns at most k slides, nearest first', async () => {
    const retriever = await open(SLIDES);
    const hits = await retriever.retrieve('Are worker bees male?');
    retriever.close();
    expect(hits.map(({ record: slide }) => slide.slideNo)).toEqual([2, 1]);
  });

  it('embeds each slide as its embedText, the text ingest embeds it as', async () => {
    const slides = [
      record({
        slideNo: 1,
        speakerNotes: 'Drones are male.',
        imageCaptions: ['A comb', 'A queen'],
      }),
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
      'slide l1/2 holds a line longer than the embedder takes',
    );
  });

  it('splits a slide over the embedder’s input length and retrieves it by either chunk’s words', async () => {
    const long = record({
      slideNo: 4,
      title: 'Honey',
      body: 'Nectar is carried home in the crop.\nHoney is ripened by fanning wings.',
    });
    const whole = embedText(long);
    const overWhole: Embedder = {
      pin: embedder.pin,
      embed: async (request) =>
        (await embedder.embed(request)).map((result, index) =>
          request.texts[index] === whole
            ? { status: 'over-length', inputTokens: 40, maxInputTokens: 30 }
            : result,
        ),
    };
    const retriever = await IndexRetriever.open(
      spec({ lectures: [{ deck, slides: [...SLIDES, long] }], embedder: overWhole, k: 1 }),
    );
    const byFirst = await retriever.retrieve('Nectar is carried home in the crop');
    const bySecond = await retriever.retrieve('Honey is ripened by fanning wings');
    retriever.close();
    expect(
      [byFirst, bySecond].map((hits) => hits.map(({ record: slide }) => slide.slideNo)),
    ).toEqual([[4], [4]]);
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

describe('IndexRetriever.tag', () => {
  it('tags every chunk but a references slide’s, and the tags reach retrieval through the topic list', async () => {
    const references = record({
      slideNo: 4,
      kind: 'references',
      title: 'References',
      body: 'Guild handbook.',
    });
    const passages: string[] = [];
    const { generator } = new ScriptedGateway((wire) => {
      const { passage } = PassageBlock.parse(JSON.parse(wire.messages[1]?.content ?? ''));
      passages.push(passage);
      return {
        status: 'content',
        content: JSON.stringify({ tags: passage.includes('red') ? ['colour vision'] : [] }),
      };
    });
    const retriever = await open([...SLIDES, references], 1);
    const before = await retriever.retrieve('What does the course say about colour vision?');
    const outcomes = await retriever.tag({ generator });
    const after = await retriever.retrieve('What does the course say about colour vision?');
    retriever.close();
    expect(outcomes.map(({ sourceId, status }) => [sourceId, status])).toEqual([
      ['l1/1', 'tagged'],
      ['l1/2', 'tagged'],
      ['l1/3', 'tagged'],
    ]);
    expect(passages.some((passage) => passage.includes('handbook'))).toBe(false);
    expect(before.map(({ record: slide }) => slide.slideNo)).not.toEqual([3]);
    expect(after.map(({ record: slide }) => slide.slideNo)).toEqual([3]);
  });
});
