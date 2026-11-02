import type { EntailmentResult, GeneratorReply, Recording } from '@cram/gateway';
import type { RetrievedSlide } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { ask } from './ask';
import { type ExplainDepth, explain } from './explain';
import {
  CONTRADICTED,
  ENTAILED,
  fakeGateway,
  generatorRecording,
  generatorReplies,
  line,
  NEUTRAL,
  pairsOf,
  scriptedSearch,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { explanationRequest } from './prompts/explanation-prompt';
import type { LineCitation } from './prompts/generation-prompt';

const QUESTION = 'Who are the workers?';
const hive = slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.');
const comb = slide('l1/2', 'Bees build comb from square cells.');
const winter = slide('l5/6', 'Bees sleep through the winter.');
const retrieved = [hive, comb];

const MALE = 'Worker bees are male.';
const SQUARE = 'Their comb is made of square cells.';
const FIRST = `In this course, ${MALE}`;
const TEXT = `${FIRST} ${SQUARE}`;

const explained = (text: string, quotes: readonly LineCitation[] = [], slides = retrieved) =>
  generatorReplies(explanationRequest(QUESTION, slides), { answer: { text, quotes } });
const uncovered = generatorReplies(explanationRequest(QUESTION, retrieved), { answer: null });
const scored = (
  hypothesis: string,
  slides: readonly RetrievedSlide[],
  ...results: EntailmentResult[]
) => ({ pairs: pairsOf(hypothesis, slides), results });
const verified = (...calls: ReturnType<typeof scored>[]): Recording =>
  verifierRecording(
    calls.flatMap(({ pairs }) => pairs),
    calls.flatMap(({ results }) => results),
  );

const run = (recordings: readonly Recording[], depth: ExplainDepth, slides = retrieved) =>
  explain(QUESTION, slides, depth, {
    gateway: fakeGateway(recordings),
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
  });

describe('explain at the light depth', () => {
  const candidates = { [FIRST]: [comb], [SQUARE]: [winter, comb] };

  it('shows every sentence the model wrote, each with its search’s candidates then its quoted slide', async () => {
    const { search, asked } = scriptedSearch(candidates);
    const result = await run(
      [
        explained(TEXT, [line('l1/1', 1)]),
        verified(
          scored(FIRST, [comb, hive], NEUTRAL, NEUTRAL),
          scored(SQUARE, [winter, comb], NEUTRAL, ENTAILED),
        ),
      ],
      { depth: 'light', searchSentence: search },
    );
    expect(asked).toEqual([FIRST, SQUARE]);
    expect(result).toEqual({
      status: 'grounded',
      explanation: {
        text: TEXT,
        quotes: [{ sourceId: 'l1/1', quote: MALE }],
        sentences: [
          { text: FIRST, slides: ['l1/2', 'l1/1'], contradicts: [] },
          { text: SQUARE, slides: ['l5/6', 'l1/2'], contradicts: [] },
        ],
        sources: ['l1/2', 'l1/1', 'l5/6'],
      },
      withheld: [],
      slides: [hive, comb, winter],
    });
  });

  it('marks a sentence a candidate contradicts and keeps every word of it', async () => {
    const { search } = scriptedSearch({ [MALE]: [hive] });
    const result = await run([explained(MALE), verified(scored(MALE, [hive], CONTRADICTED))], {
      depth: 'light',
      searchSentence: search,
    });
    expect(result).toMatchObject({
      status: 'grounded',
      explanation: { text: MALE, sentences: [{ text: MALE, contradicts: ['l1/1'] }] },
    });
  });

  it('withholds a bad pointer as dangling-citation and leaves its sentence whole', async () => {
    const { search } = scriptedSearch({ [SQUARE]: [comb] });
    const result = await run(
      [
        explained(SQUARE, [line('l1/1', 2), line('l1/2', 9)]),
        verified(scored(SQUARE, [comb], NEUTRAL)),
      ],
      { depth: 'light', searchSentence: search },
    );
    expect(result).toEqual({
      status: 'grounded',
      explanation: {
        text: SQUARE,
        quotes: [],
        sentences: [{ text: SQUARE, slides: ['l1/2'], contradicts: [] }],
        sources: ['l1/2'],
      },
      withheld: [
        {
          reason: 'dangling-citation',
          text: 'The queen is the colony’s only female.',
          sourceId: 'l1/1',
        },
        { reason: 'dangling-citation', text: '[9]', sourceId: 'l1/2' },
      ],
      slides: retrieved,
    });
  });

  it('is not-covered when the model returns null, and searches nothing', async () => {
    const { search, asked } = scriptedSearch({});
    await expect(run([uncovered], { depth: 'light', searchSentence: search })).resolves.toEqual({
      status: 'not-covered',
      withheld: [],
    });
    expect(asked).toEqual([]);
  });

  it('is not-covered with nothing retrieved, and calls no model', async () => {
    const { search } = scriptedSearch({});
    await expect(run([], { depth: 'light', searchSentence: search }, [])).resolves.toEqual({
      status: 'not-covered',
      withheld: [],
    });
  });

  it('throws when no sentence names any slide', async () => {
    const { search } = scriptedSearch({});
    await expect(
      run([explained(SQUARE)], { depth: 'light', searchSentence: search }),
    ).rejects.toThrow('explain: an explanation names no slide');
  });

  it('reports a generator failure at the generate stage', async () => {
    const failure: GeneratorReply = { status: 'backend-failed', reason: 'connection refused' };
    const { search } = scriptedSearch({});
    await expect(
      run([generatorRecording(explanationRequest(QUESTION, retrieved), failure)], {
        depth: 'light',
        searchSentence: search,
      }),
    ).resolves.toMatchObject({ status: 'model-failed', stage: 'generate' });
  });

  it('is what ask runs', async () => {
    const { search } = scriptedSearch({ [MALE]: [hive] });
    const result = await ask(QUESTION, retrieved, {
      gateway: fakeGateway([explained(MALE), verified(scored(MALE, [hive], CONTRADICTED))]),
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
      searchSentence: search,
    });
    expect(result).toMatchObject({ explanation: { sentences: [{ contradicts: ['l1/1'] }] } });
  });
});

describe('explain at the deep depth', () => {
  const deep = (secondOpinion = false): ExplainDepth => ({ depth: 'deep', secondOpinion });

  it('cuts a contradicted sentence, names its slide, and shows the rest with its entailing slides', async () => {
    const result = await run(
      [
        explained(TEXT, [line('l1/1', 1)]),
        verified(
          scored(FIRST, retrieved, CONTRADICTED, NEUTRAL),
          scored(SQUARE, retrieved, NEUTRAL, ENTAILED),
        ),
      ],
      deep(),
    );
    expect(result).toEqual({
      status: 'grounded',
      explanation: {
        text: SQUARE,
        quotes: [],
        sentences: [{ text: SQUARE, slides: ['l1/2'], contradicts: [] }],
        sources: ['l1/2'],
      },
      withheld: [{ reason: 'contradicted', text: FIRST, sourceId: 'l1/1' }],
      slides: retrieved,
    });
  });

  it('keeps a quote in a kept sentence and names its slide among the sources', async () => {
    const result = await run(
      [
        explained(TEXT, [line('l1/1', 1)]),
        verified(
          scored(FIRST, retrieved, ENTAILED, NEUTRAL),
          scored(SQUARE, retrieved, NEUTRAL, NEUTRAL),
        ),
      ],
      deep(),
    );
    expect(result).toMatchObject({
      explanation: { text: FIRST, quotes: [{ sourceId: 'l1/1', quote: MALE }], sources: ['l1/1'] },
      withheld: [{ reason: 'unsupported', text: SQUARE }],
    });
  });

  it('names a quoted slide among the sources when another slide entails its sentence', async () => {
    const result = await run(
      [explained(FIRST, [line('l1/1', 1)]), verified(scored(FIRST, retrieved, NEUTRAL, ENTAILED))],
      deep(),
    );
    expect(result).toMatchObject({
      explanation: {
        sentences: [{ slides: ['l1/2'] }],
        quotes: [{ sourceId: 'l1/1' }],
        sources: ['l1/2', 'l1/1'],
      },
    });
  });

  it('withholds a neutral sentence as unsupported', async () => {
    const result = await run(
      [
        explained(TEXT),
        verified(
          scored(FIRST, retrieved, ENTAILED, NEUTRAL),
          scored(SQUARE, retrieved, NEUTRAL, NEUTRAL),
        ),
      ],
      deep(),
    );
    expect(result).toMatchObject({
      status: 'grounded',
      withheld: [{ reason: 'unsupported', text: SQUARE }],
    });
  });

  it('is not-covered with every sentence withheld when none is entailed, a contradicted one naming its slide', async () => {
    const result = await run(
      [
        explained(TEXT),
        verified(
          scored(FIRST, retrieved, NEUTRAL, CONTRADICTED),
          scored(SQUARE, retrieved, NEUTRAL, NEUTRAL),
        ),
      ],
      deep(),
    );
    expect(result).toEqual({
      status: 'not-covered',
      withheld: [
        { reason: 'contradicted', text: FIRST, sourceId: 'l1/2' },
        { reason: 'ungrounded', text: SQUARE },
      ],
    });
  });

  it('puts a dropped pointer before the sentences it withholds', async () => {
    const result = await run(
      [explained(SQUARE, [line('l1/2', 9)]), verified(scored(SQUARE, retrieved, NEUTRAL, NEUTRAL))],
      deep(),
    );
    expect(result).toEqual({
      status: 'not-covered',
      withheld: [
        { reason: 'dangling-citation', text: '[9]', sourceId: 'l1/2' },
        { reason: 'ungrounded', text: SQUARE },
      ],
    });
  });
});
