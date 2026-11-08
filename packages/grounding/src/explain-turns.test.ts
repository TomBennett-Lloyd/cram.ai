import type { ChatRequest, ChatResult, EntailRequest } from '@cram/gateway';
import type { AskTurn } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { explain } from './explain';
import {
  comb,
  contextOf,
  explained,
  FIRST,
  hive,
  hiveSummary,
  QUESTION,
  retrieved,
  scored,
  SQUARE,
  TEXT,
  verified,
  winter,
} from './explain-fixture';
import { fakeGateway, NEUTRAL, scriptedSearch } from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { scoredPremises, slidePremise } from './premise';
import { requestTokens } from './prompt-budget';
import { explanationRequest, turnBlock } from './prompts/explanation-prompt';
import { sourceBlock, summaryBlock } from './prompts/source-block';

const TURNS: readonly AskTurn[] = [
  { question: 'How many queens rule a hive?', answer: 'Each colony keeps a single queen.' },
  { question: 'How do bees see colour?', answer: null },
];
const turnTexts = TURNS.flatMap(({ question, answer }) => [question, answer ?? '']).filter(
  (text) => text !== '',
);

/** `docs/adr/0011-ask-conversation.md` § Decision (c), (e): the carried turns are context for the generator and nothing else. */
describe('explain with carried turns', () => {
  const candidates = { [FIRST]: [comb], [SQUARE]: [winter, comb] };
  const recordings = [
    explained(TEXT, [], retrieved, [hiveSummary], TURNS),
    verified(
      scored(FIRST, [comb, hive], NEUTRAL, NEUTRAL),
      scored(SQUARE, [winter, comb], NEUTRAL, NEUTRAL),
    ),
  ];

  const answered = async () => {
    const { search, asked } = scriptedSearch(candidates);
    const { generator, verifier } = fakeGateway(recordings);
    const entailed: EntailRequest[] = [];
    const entail = (request: EntailRequest) => {
      entailed.push(request);
      return verifier.entail(request);
    };
    const result = await explain(
      { question: QUESTION, turns: [...TURNS] },
      { retrieved, summaries: [hiveSummary] },
      { depth: 'light', searchSentence: search },
      {
        gateway: { generator, verifier: { ...verifier, entail } },
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
      },
    );
    return { result, asked, entailed };
  };

  it('shows the turns to the generator after the summaries and before the question', () => {
    const request = explanationRequest(QUESTION, contextOf(retrieved, [hiveSummary]), TURNS);
    expect(request.messages[1]?.content).toBe(
      [
        ...retrieved.map(sourceBlock),
        summaryBlock(hiveSummary),
        ...TURNS.map(turnBlock),
        `<question>${QUESTION}</question>`,
      ].join('\n\n'),
    );
  });

  it('searches the new answer’s sentences and nothing from a turn', async () => {
    const { asked } = await answered();
    expect(asked).toEqual([FIRST, SQUARE]);
  });

  it('scores each sentence against slide premises only, none holding a turn’s text', async () => {
    const { entailed } = await answered();
    const slideTexts = new Set(
      [comb, winter, hive].flatMap((slide) =>
        scoredPremises([slidePremise(slide)]).map(({ text }) => text),
      ),
    );
    const premises = entailed.flatMap(({ pairs }) => pairs.map(({ premise }) => premise));
    expect(premises.length).toBeGreaterThan(0);
    for (const premise of premises) {
      expect(slideTexts).toContain(premise);
      for (const text of turnTexts) expect(premise).not.toContain(text);
    }
  });

  it('names only the slides as sources, beneath the answer and beside each sentence', async () => {
    const { result } = await answered();
    expect(result).toMatchObject({
      status: 'grounded',
      explanation: {
        sentences: [
          { text: FIRST, slides: ['l1/2', 'l1/1'] },
          { text: SQUARE, slides: ['l5/6', 'l1/2'] },
        ],
        sources: ['l1/2', 'l1/1', 'l5/6'],
      },
    });
  });

  it('counts the turns in the fixed cost, so the prompt sent stays within the budget', async () => {
    const budget =
      requestTokens(explanationRequest(QUESTION, contextOf(retrieved, [hiveSummary]), TURNS)) - 1;
    const sent: ChatRequest<unknown>[] = [];
    const { generator, verifier } = fakeGateway([]);
    const chat = <T>(request: ChatRequest<T>): Promise<ChatResult<T>> => {
      sent.push(request);
      return Promise.resolve({
        status: 'backend-failed',
        cause: 'request-error',
        reason: 'captured',
      });
    };
    const result = await explain(
      { question: QUESTION, turns: [...TURNS] },
      { retrieved, summaries: [hiveSummary] },
      { depth: 'light', searchSentence: scriptedSearch({}).search },
      {
        gateway: { generator: { ...generator, chat }, verifier },
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
        budget,
      },
    );
    expect(result.context.summaries).toEqual([]);
    expect(sent.map(requestTokens).every((used) => used <= budget)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('sends today’s request for a new thread', () => {
    const request = explanationRequest(QUESTION, contextOf(), []);
    expect(request.messages[1]?.content).not.toMatch(/<turn>/);
    expect(request.messages[1]?.content).toBe(
      [...retrieved.map(sourceBlock), `<question>${QUESTION}</question>`].join('\n\n'),
    );
  });
});
