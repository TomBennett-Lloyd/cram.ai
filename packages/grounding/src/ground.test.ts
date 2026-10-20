import type { EntailmentResult, GeneratorReply, Recording } from '@cram/gateway';
import type { Citation, PartialPolicy } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { ask } from './ask';
import { splitClaims } from './claims';
import {
  answer,
  cite,
  ENTAILED,
  fakeGateway,
  generatorRecording,
  generatorReplies,
  NEUTRAL,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';
import { ground } from './ground';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { generationRequest } from './prompts/generation-prompt';
import { rewriteRequest } from './prompts/rewrite-prompt';
import { verifierRequest } from './prompts/verifier-prompt';
import type { Quotes } from './verifier-input';
import type { VerifierStrategy } from './verify';

const QUESTION = 'Who are the workers?';
const task = { kind: 'answer-sentence', question: QUESTION } as const;
const retrieved = [
  slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.'),
  slide('l1/2', 'Bees build comb from square cells.'),
];

const male = cite('l1/1', 'Worker bees are male.');
const square = cite('l1/2', 'square cells');
const PARTIAL_TEXT = 'Workers are male. They forage at night.';

const generated = (...units: { text: string; citations: Citation[] }[]): Recording =>
  generatorReplies(generationRequest(task, retrieved), { units });
const quotesOf = (citations: readonly Citation[]): Quotes => {
  const [first, ...rest] = citations.map((citation) => citation.quote);
  if (first === undefined) throw new Error('a judged unit has quotes');
  return [first, ...rest];
};
const nli = (text: string, citations: readonly Citation[], ...results: EntailmentResult[]) =>
  verifierRecording(
    splitClaims(text).map((hypothesis) => ({
      premise: quotesOf(citations).join('\n'),
      hypothesis,
    })),
    results,
  );
const rewritten = (text: string, citations: readonly Citation[], to: string) =>
  generatorReplies(rewriteRequest({ text, quotes: quotesOf(citations) }), { text: to });

const run = (
  recordings: readonly Recording[],
  partialPolicy: PartialPolicy = 'drop',
  strategy: VerifierStrategy = 'nli',
  slides = retrieved,
) =>
  ground(task, slides, {
    gateway: fakeGateway(recordings),
    strategy,
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
    partialPolicy,
  });

describe('ground', () => {
  it('drops a confident sentence that cites nothing, before it reaches the verifier', async () => {
    const uncited = { text: 'Worker bees are female.', citations: [] };
    const cited = { text: 'Workers are male.', citations: [male] };
    await expect(
      run([generated(uncited, cited), nli(cited.text, [male], ENTAILED)]),
    ).resolves.toEqual({
      status: 'grounded',
      shown: [answer(cited.text, [male])],
      withheld: [{ reason: 'dangling-citation', unit: answer(uncited.text, []) }],
    });
  });

  it('drops a sentence citing a slide that does not say it, whether the quote is absent or merely unsupportive', async () => {
    const absent = {
      text: 'Workers forage at night.',
      citations: [cite('l1/2', 'forage at night')],
    };
    const unsupportive = { text: 'Workers forage at night.', citations: [square] };
    await expect(
      run([generated(absent, unsupportive), nli(unsupportive.text, [square], NEUTRAL)]),
    ).resolves.toEqual({
      status: 'not-covered',
      withheld: [
        { reason: 'dangling-citation', unit: answer(absent.text, absent.citations) },
        { reason: 'unsupported', unit: answer(unsupportive.text, [square]) },
      ],
    });
  });

  it('withholds a partial unit under drop, naming the policy', async () => {
    const partial = { text: PARTIAL_TEXT, citations: [male] };
    await expect(
      run([generated(partial), nli(PARTIAL_TEXT, [male], ENTAILED, NEUTRAL)]),
    ).resolves.toEqual({
      status: 'not-covered',
      withheld: [{ reason: 'partial', policy: 'drop', unit: answer(PARTIAL_TEXT, [male]) }],
    });
  });

  describe('rewrite-once', () => {
    const partial = { text: PARTIAL_TEXT, citations: [male] };
    const firstPass = [generated(partial), nli(PARTIAL_TEXT, [male], ENTAILED, NEUTRAL)];

    it('shows a rewrite the verifier supports, keeping the unit’s citations', async () => {
      const to = 'Workers are male.';
      await expect(
        run(
          [...firstPass, rewritten(PARTIAL_TEXT, [male], to), nli(to, [male], ENTAILED)],
          'rewrite-once',
        ),
      ).resolves.toEqual({ status: 'grounded', shown: [answer(to, [male])], withheld: [] });
    });

    it('withholds a rewrite judged partial again, naming the policy', async () => {
      const to = 'Workers are male. They sleep at noon.';
      await expect(
        run(
          [...firstPass, rewritten(PARTIAL_TEXT, [male], to), nli(to, [male], ENTAILED, NEUTRAL)],
          'rewrite-once',
        ),
      ).resolves.toEqual({
        status: 'not-covered',
        withheld: [{ reason: 'partial', policy: 'rewrite-once', unit: answer(to, [male]) }],
      });
    });

    it('withholds a rewrite judged unsupported as unsupported', async () => {
      const to = 'Workers sleep at noon.';
      await expect(
        run(
          [...firstPass, rewritten(PARTIAL_TEXT, [male], to), nli(to, [male], NEUTRAL)],
          'rewrite-once',
        ),
      ).resolves.toEqual({
        status: 'not-covered',
        withheld: [{ reason: 'unsupported', unit: answer(to, [male]) }],
      });
    });

    it('does not rewrite a unit that was not partial', async () => {
      const cited = { text: 'Workers are male.', citations: [male] };
      await expect(
        run([generated(cited), nli(cited.text, [male], NEUTRAL)], 'rewrite-once'),
      ).resolves.toMatchObject({ status: 'not-covered', withheld: [{ reason: 'unsupported' }] });
    });
  });

  it('is not-covered, with nothing withheld, when the model finds the slides do not cover the question', async () => {
    await expect(run([generated()])).resolves.toEqual({ status: 'not-covered', withheld: [] });
  });

  it('is not-covered without asking the generator when nothing was retrieved', async () => {
    await expect(run([], 'drop', 'nli', [])).resolves.toEqual({
      status: 'not-covered',
      withheld: [],
    });
  });

  describe('a model failure is reported with its stage, never as not-covered', () => {
    const failed: GeneratorReply = { status: 'backend-failed', reason: 'connection refused' };
    const cited = { text: 'Workers are male.', citations: [male] };

    it('in generation', async () => {
      await expect(
        run([generatorRecording(generationRequest(task, retrieved), failed)]),
      ).resolves.toEqual({
        status: 'model-failed',
        stage: 'generate',
        failure: failed,
      });
    });

    it('in verification', async () => {
      const verifying = generatorRecording(
        verifierRequest({ text: cited.text, quotes: [male.quote] }),
        failed,
      );
      await expect(run([generated(cited), verifying], 'drop', 'llm')).resolves.toEqual({
        status: 'model-failed',
        stage: 'verify',
        failure: failed,
      });
    });

    it('in the rewrite', async () => {
      const partial = { text: PARTIAL_TEXT, citations: [male] };
      const rewriting = generatorRecording(
        rewriteRequest({ text: PARTIAL_TEXT, quotes: [male.quote] }),
        failed,
      );
      await expect(
        run(
          [generated(partial), nli(PARTIAL_TEXT, [male], ENTAILED, NEUTRAL), rewriting],
          'rewrite-once',
        ),
      ).resolves.toEqual({ status: 'model-failed', stage: 'rewrite', failure: failed });
    });

    it('in re-verifying a rewrite', async () => {
      const partial = { text: PARTIAL_TEXT, citations: [male] };
      const to = 'Workers are male.';
      const reverifying = generatorRecording(
        verifierRequest({ text: to, quotes: [male.quote] }),
        failed,
      );
      const recordings = [
        generated(partial),
        generatorReplies(verifierRequest({ text: PARTIAL_TEXT, quotes: [male.quote] }), {
          verdict: 'partial',
        }),
        rewritten(PARTIAL_TEXT, [male], to),
        reverifying,
      ];
      await expect(run(recordings, 'rewrite-once', 'llm')).resolves.toEqual({
        status: 'model-failed',
        stage: 'verify',
        failure: failed,
      });
    });
  });
});

describe('ask', () => {
  it('withholds a partial answer sentence under drop', async () => {
    const partial = { text: PARTIAL_TEXT, citations: [male] };
    const result = ask(QUESTION, retrieved, {
      gateway: fakeGateway([generated(partial), nli(PARTIAL_TEXT, [male], ENTAILED, NEUTRAL)]),
      strategy: 'nli',
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
    });
    await expect(result).resolves.toMatchObject({
      status: 'not-covered',
      withheld: [{ reason: 'partial', policy: 'drop' }],
    });
  });
});
