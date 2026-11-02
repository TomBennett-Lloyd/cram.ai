import type { GeneratorReply } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import { ask } from './ask';
import {
  QUESTION,
  hive,
  comb,
  winter,
  retrieved,
  MALE,
  SQUARE,
  FIRST,
  TEXT,
  explained,
  uncovered,
  scored,
  verified,
  run,
} from './explain-fixture';
import {
  CONTRADICTED,
  ENTAILED,
  fakeGateway,
  generatorRecording,
  line,
  NEUTRAL,
  scriptedSearch,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { explanationRequest } from './prompts/explanation-prompt';

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

  it('names the slides it was written from when no sentence names one', async () => {
    const { search } = scriptedSearch({});
    await expect(
      run([explained(SQUARE), verified()], { depth: 'light', searchSentence: search }),
    ).resolves.toMatchObject({
      status: 'grounded',
      explanation: {
        sentences: [{ text: SQUARE, slides: [], contradicts: [] }],
        sources: ['l1/1', 'l1/2'],
      },
    });
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
