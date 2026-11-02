import type { EntailmentResult, GeneratorReply, Recording } from '@cram/gateway';
import type { RetrievedSlide } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import {
  CONTRADICTED,
  ENTAILED,
  fakeGateway,
  generatorRecording,
  generatorReplies,
  NEUTRAL,
  OVER_LENGTH,
  pairsOf,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { verifierRequest } from './prompts/verifier-prompt';
import { slideText } from './slide-text';
import { verifyExplanation } from './verify-explanation';

const hive = slide('l1/1', 'Worker bees are male.');
const comb = slide('l1/2', 'Bees build comb from square cells.');
const retrieved = [hive, comb];
const SENTENCE = 'Workers are male.';

const judged = (
  sentence: string,
  slides: readonly RetrievedSlide[],
  ...results: EntailmentResult[]
) => verifierRecording(pairsOf(sentence, slides), results);
const secondOpinion = (slideOf: RetrievedSlide, reply: GeneratorReply | { verdict: string }) => {
  const request = verifierRequest({ text: SENTENCE, quotes: [slideText(slideOf.record)] });
  return 'status' in reply ? generatorRecording(request, reply) : generatorReplies(request, reply);
};

const verify = (
  recordings: readonly Recording[],
  withSecondOpinion = false,
  sentences = [SENTENCE],
) =>
  verifyExplanation(sentences, retrieved, {
    gateway: fakeGateway(recordings),
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
    secondOpinion: withSecondOpinion,
  });

describe('verifyExplanation', () => {
  it('scores every sentence against every retrieved slide in one call', async () => {
    const two = ['Workers are male.', 'Cells are square.'];
    const recording = verifierRecording(
      [...pairsOf(two[0] ?? '', retrieved), ...pairsOf(two[1] ?? '', retrieved)],
      [ENTAILED, NEUTRAL, NEUTRAL, ENTAILED],
    );
    await expect(verify([recording], false, two)).resolves.toEqual({
      status: 'verified',
      kept: [
        { text: 'Workers are male.', slides: ['l1/1'], contradicts: [] },
        { text: 'Cells are square.', slides: ['l1/2'], contradicts: [] },
      ],
      withheld: [],
    });
  });

  it('keeps a sentence entailed at exactly entailedAt, asking no second opinion beside it', async () => {
    const at: EntailmentResult = {
      status: 'scored',
      scores: { entailment: PROVISIONAL_NLI_THRESHOLDS.entailedAt, neutral: 0.5, contradiction: 0 },
    };
    await expect(
      verify([judged(SENTENCE, retrieved, at, OVER_LENGTH)], true),
    ).resolves.toMatchObject({
      kept: [{ slides: ['l1/1'] }],
    });
  });

  it('keeps a sentence one slide entails though another contradicts it', async () => {
    await expect(verify([judged(SENTENCE, retrieved, CONTRADICTED, ENTAILED)])).resolves.toEqual({
      status: 'verified',
      kept: [{ text: SENTENCE, slides: ['l1/2'], contradicts: [] }],
      withheld: [],
    });
  });

  it('cuts a sentence no slide entails and one contradicts, naming the first such slide', async () => {
    await expect(verify([judged(SENTENCE, retrieved, NEUTRAL, CONTRADICTED)])).resolves.toEqual({
      status: 'verified',
      kept: [],
      withheld: [{ reason: 'contradicted', text: SENTENCE, sourceId: 'l1/2' }],
    });
    const both = await verify([judged(SENTENCE, retrieved, CONTRADICTED, CONTRADICTED)]);
    expect(both).toMatchObject({ withheld: [{ sourceId: 'l1/1' }] });
  });

  it('keeps an entailed sentence with every slide that entails it', async () => {
    await expect(verify([judged(SENTENCE, retrieved, ENTAILED, ENTAILED)])).resolves.toMatchObject({
      kept: [{ slides: ['l1/1', 'l1/2'] }],
    });
  });

  it('withholds a neutral sentence as unsupported beside a kept one, and as ungrounded alone', async () => {
    const two = ['Workers are male.', 'Cells are square.'];
    const mixed = verifierRecording(
      [...pairsOf(two[0] ?? '', retrieved), ...pairsOf(two[1] ?? '', retrieved)],
      [ENTAILED, NEUTRAL, NEUTRAL, NEUTRAL],
    );
    await expect(verify([mixed], false, two)).resolves.toMatchObject({
      withheld: [{ reason: 'unsupported', text: 'Cells are square.' }],
    });
    await expect(verify([judged(SENTENCE, retrieved, NEUTRAL, NEUTRAL)])).resolves.toEqual({
      status: 'verified',
      kept: [],
      withheld: [{ reason: 'ungrounded', text: SENTENCE }],
    });
  });

  it('counts an over-length pair as contradicted with no second opinion, unless a scored slide entails', async () => {
    await expect(
      verify([judged(SENTENCE, retrieved, NEUTRAL, OVER_LENGTH)]),
    ).resolves.toMatchObject({
      withheld: [{ reason: 'contradicted', sourceId: 'l1/2' }],
    });
    await expect(
      verify([judged(SENTENCE, retrieved, ENTAILED, OVER_LENGTH)]),
    ).resolves.toMatchObject({
      kept: [{ slides: ['l1/1'] }],
    });
  });

  it('asks no second opinion when a scored slide already entails', async () => {
    await expect(
      verify([judged(SENTENCE, retrieved, ENTAILED, OVER_LENGTH)], true),
    ).resolves.toMatchObject({ kept: [{ slides: ['l1/1'] }] });
  });

  it.each([
    ['supported', { kept: [{ slides: ['l1/2'] }], withheld: [] }],
    ['partial', { kept: [], withheld: [{ reason: 'ungrounded' }] }],
    ['unsupported', { kept: [], withheld: [{ reason: 'ungrounded' }] }],
  ])('reads a second opinion of %s on an over-length pair', async (verdict, expected) => {
    const recordings = [
      judged(SENTENCE, retrieved, NEUTRAL, OVER_LENGTH),
      secondOpinion(comb, { verdict }),
    ];
    await expect(verify(recordings, true)).resolves.toMatchObject(expected);
  });

  it('reports a failed second opinion as a model failure', async () => {
    const failed: GeneratorReply = { status: 'backend-failed', reason: 'connection refused' };
    const recordings = [
      judged(SENTENCE, retrieved, NEUTRAL, OVER_LENGTH),
      secondOpinion(comb, failed),
    ];
    await expect(verify(recordings, true)).resolves.toEqual({
      status: 'model-failed',
      failure: failed,
    });
  });

  it('throws when the verifier answers a different number of pairs', async () => {
    const { generator, verifier } = fakeGateway([]);
    const short = { pin: verifier.pin, entail: () => Promise.resolve([ENTAILED]) };
    await expect(
      verifyExplanation([SENTENCE], retrieved, {
        gateway: { generator, verifier: short },
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
        secondOpinion: false,
      }),
    ).rejects.toThrow('verifier returned 1 results for 2 pairs');
  });
});
