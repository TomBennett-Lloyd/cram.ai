import type { ChatRequest, ChatResult, GeneratorReply } from '@cram/gateway';
import type { LoadedSummary, RetrievedSlide } from '@cram/shared';
import { explain } from './explain';
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
  contextOf,
  hiveSummary,
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
import { requestTokens } from './prompt-budget';
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
      context: contextOf(),
    });
  });

  it('attributes the sentence after a quoted line on its own', async () => {
    const quoted = `The slides put it plainly: "${MALE}"`;
    const { search, asked } = scriptedSearch({ [quoted]: [comb], [SQUARE]: [winter] });
    const result = await run(
      [
        explained(`${quoted} ${SQUARE}`, [line('l1/1', 1)]),
        verified(
          scored(quoted, [comb, hive], NEUTRAL, ENTAILED),
          scored(SQUARE, [winter], NEUTRAL),
        ),
      ],
      { depth: 'light', searchSentence: search },
    );
    expect(asked).toEqual([quoted, SQUARE]);
    expect(result).toMatchObject({
      status: 'grounded',
      explanation: {
        quotes: [{ sourceId: 'l1/1', quote: MALE }],
        sentences: [
          { text: quoted, slides: ['l1/2', 'l1/1'], contradicts: [] },
          { text: SQUARE, slides: ['l5/6'], contradicts: [] },
        ],
      },
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
      context: contextOf(),
    });
  });

  it('is not-covered when the model returns null, and searches nothing', async () => {
    const { search, asked } = scriptedSearch({});
    await expect(run([uncovered], { depth: 'light', searchSentence: search })).resolves.toEqual({
      status: 'not-covered',
      withheld: [],
      context: contextOf(),
    });
    expect(asked).toEqual([]);
  });

  it('is not-covered with nothing retrieved, and calls no model', async () => {
    const { search } = scriptedSearch({});
    await expect(run([], { depth: 'light', searchSentence: search }, [])).resolves.toEqual({
      status: 'not-covered',
      withheld: [],
      context: contextOf([]),
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
      run([generatorRecording(explanationRequest(QUESTION, contextOf()), failure)], {
        depth: 'light',
        searchSentence: search,
      }),
    ).resolves.toMatchObject({ status: 'model-failed', stage: 'generate' });
  });

  it('is what ask runs', async () => {
    const { search } = scriptedSearch({ [MALE]: [hive] });
    const result = await ask(
      QUESTION,
      { retrieved, summaries: [] },
      {
        gateway: fakeGateway([explained(MALE), verified(scored(MALE, [hive], CONTRADICTED))]),
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
        searchSentence: search,
      },
    );
    expect(result).toMatchObject({ explanation: { sentences: [{ contradicts: ['l1/1'] }] } });
  });
});

/** A gateway whose generator records each request and fails it, so a test reads what was sent. */
const capturing = () => {
  const sent: ChatRequest<unknown>[] = [];
  const { generator, verifier } = fakeGateway([]);
  const chat = <T>(request: ChatRequest<T>): Promise<ChatResult<T>> => {
    sent.push(request);
    return Promise.resolve({ status: 'backend-failed', reason: 'captured' });
  };
  return { sent, gateway: { verifier, generator: { ...generator, chat } } };
};

describe('explain’s context', () => {
  const tokens = (raw: readonly RetrievedSlide[], summaries: readonly LoadedSummary[] = []) =>
    requestTokens(explanationRequest(QUESTION, contextOf(raw, summaries)));
  const light = () => ({ depth: 'light' as const, searchSentence: scriptedSearch({}).search });
  const sources = { retrieved, summaries: [hiveSummary] };

  it('sends the retrieved slides, then their lectures’ summaries, when the budget holds them', async () => {
    const result = await run(
      [explained(SQUARE, [], retrieved, [hiveSummary]), verified()],
      light(),
      retrieved,
      [hiveSummary],
    );
    expect(result).toMatchObject({
      status: 'grounded',
      context: contextOf(retrieved, [hiveSummary]),
    });
  });

  it('drops the summary first under a scripted budget, leaving out each ranked slide of its lecture', async () => {
    const budget = tokens(retrieved, [hiveSummary]) - 1;
    const result = await run(
      [explained(SQUARE), verified()],
      light(),
      retrieved,
      [hiveSummary],
      budget,
    );
    expect(result).toMatchObject({
      context: contextOf(retrieved, [], [hive.sourceId, comb.sourceId]),
    });
  });

  it('then drops slides from the bottom, never the last, and a pointer to a dropped slide dangles', async () => {
    const result = await run(
      [explained(MALE, [line('l1/2', 1)], [hive]), verified()],
      light(),
      retrieved,
      [hiveSummary],
      tokens(retrieved) - 1,
    );
    expect(result).toMatchObject({
      status: 'grounded',
      explanation: { quotes: [] },
      withheld: [{ reason: 'dangling-citation', sourceId: 'l1/2' }],
      slides: retrieved,
      context: contextOf([hive], [], [hive.sourceId, comb.sourceId]),
    });
  });

  it('drops a pointer to a slide the budget dropped, though retrieval returned it', async () => {
    const [combLine] = comb.record.body.split('\n');
    const result = await run(
      [explained(combLine ?? '', [line('l1/2', 1)], [hive]), verified()],
      light(),
      retrieved,
      [],
      tokens(retrieved) - 1,
    );
    expect(result).toMatchObject({
      explanation: { quotes: [], sources: [hive.sourceId] },
      withheld: [{ reason: 'dangling-citation', sourceId: comb.sourceId }],
    });
  });

  it('never sends a prompt over a scripted budget unless one slide alone is over it', async () => {
    const budgets = [0, tokens([hive]), tokens(retrieved) - 1, tokens(retrieved, [hiveSummary])];
    for (const budget of budgets) {
      const { sent, gateway } = capturing();
      const result = await explain(QUESTION, sources, light(), {
        gateway,
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
        budget,
      });
      const [request] = sent;
      if (request === undefined) throw new Error('nothing was sent');
      expect(result).toMatchObject({ status: 'model-failed', stage: 'generate' });
      expect(result.context.raw.length).toBeGreaterThan(0);
      if (requestTokens(request) > budget) expect(result.context.raw).toEqual([hive]);
      expect(request).toEqual(explanationRequest(QUESTION, result.context));
    }
  });
});
