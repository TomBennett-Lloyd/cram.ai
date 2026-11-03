import type { EntailmentResult, GeneratorReply, Recording } from '@cram/gateway';
import { type RetrievedSlide, SourceId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import {
  CONTRADICTED,
  ENTAILED,
  fakeGateway,
  generatorRecording,
  generatorReplies,
  kindsRecording,
  NEUTRAL,
  OVER_LENGTH,
  pairsOf,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { verifierRequest } from './prompts/verifier-prompt';
import { slideText } from './slide-text';
import { type Premise, slidePremise } from './premise';
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
  verifyExplanation(sentences, retrieved.map(slidePremise), {
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

  it('credits every slide each entailing premise names, once, and a contradicting premise names its first', async () => {
    const units: Premise[] = [
      { text: 'Workers are the males.', sources: [SourceId.parse('l1/3'), SourceId.parse('l1/1')] },
      { text: 'Males work.', sources: [SourceId.parse('l1/1'), SourceId.parse('l1/4')] },
    ];
    const pairs = (sentence: string) =>
      units.map(({ text }) => ({ premise: text, hypothesis: sentence }));
    const entailedBoth = verifyExplanation([SENTENCE], units, {
      gateway: fakeGateway([verifierRecording(pairs(SENTENCE), [ENTAILED, ENTAILED])]),
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
      secondOpinion: false,
    });
    await expect(entailedBoth).resolves.toMatchObject({
      kept: [{ text: SENTENCE, slides: ['l1/3', 'l1/1', 'l1/4'] }],
    });
    const contradicted = verifyExplanation([SENTENCE], units, {
      gateway: fakeGateway([verifierRecording(pairs(SENTENCE), [CONTRADICTED, NEUTRAL])]),
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
      secondOpinion: false,
    });
    await expect(contradicted).resolves.toMatchObject({
      withheld: [{ reason: 'contradicted', sourceId: 'l1/3' }],
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

  it('withholds a neutral course claim as unsupported beside a kept one, and as ungrounded alone', async () => {
    const two = ['Workers are male.', 'Cells are square.'];
    const mixed = verifierRecording(
      [...pairsOf(two[0] ?? '', retrieved), ...pairsOf(two[1] ?? '', retrieved)],
      [ENTAILED, NEUTRAL, NEUTRAL, NEUTRAL],
    );
    const claim = kindsRecording(['Cells are square.'], retrieved, ['course-claim']);
    await expect(verify([mixed, claim], false, two)).resolves.toMatchObject({
      withheld: [{ reason: 'unsupported', text: 'Cells are square.' }],
    });
    const alone = kindsRecording([SENTENCE], retrieved, ['course-claim']);
    await expect(verify([judged(SENTENCE, retrieved, NEUTRAL, NEUTRAL), alone])).resolves.toEqual({
      status: 'verified',
      kept: [],
      withheld: [{ reason: 'ungrounded', text: SENTENCE }],
    });
  });

  describe('the sentence-kind pass over the neutral sentences', () => {
    const FIVE = [
      'A worker is a bee of the working caste.',
      'Workers are male.',
      'Cells are square.',
      'So a cell is one of the comb’s compartments.',
      'Drones guard the hive.',
    ];
    const NEUTRAL_ONES = [FIVE[0], FIVE[2], FIVE[3], FIVE[4]].map((text) => text ?? '');
    const stage1 = verifierRecording(
      FIVE.flatMap((text) => pairsOf(text, retrieved)),
      [NEUTRAL, NEUTRAL, ENTAILED, NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL],
    );

    it('sends only the neutral sentences, in order, and keeps each interpretation with no slide', async () => {
      const kinds = kindsRecording(NEUTRAL_ONES, retrieved, [
        'interpretation',
        'course-claim',
        'interpretation',
        'course-claim',
      ]);
      await expect(verify([stage1, kinds], false, FIVE)).resolves.toEqual({
        status: 'verified',
        kept: [
          { text: FIVE[0], slides: [], contradicts: [] },
          { text: FIVE[1], slides: ['l1/1'], contradicts: [] },
          { text: FIVE[3], slides: [], contradicts: [] },
        ],
        withheld: [
          { reason: 'unsupported', text: FIVE[2] },
          { reason: 'unsupported', text: FIVE[4] },
        ],
      });
    });

    it('never sends an entailed or a contradicted sentence', async () => {
      const three = ['Workers are male.', 'Cells are round.', 'Cells are square.'];
      const recording = verifierRecording(
        three.flatMap((text) => pairsOf(text, retrieved)),
        [ENTAILED, NEUTRAL, NEUTRAL, CONTRADICTED, NEUTRAL, NEUTRAL],
      );
      const kinds = kindsRecording(['Cells are square.'], retrieved, ['interpretation']);
      await expect(verify([recording, kinds], false, three)).resolves.toMatchObject({
        kept: [{ text: 'Workers are male.' }, { text: 'Cells are square.', slides: [] }],
        withheld: [{ reason: 'contradicted', text: 'Cells are round.', sourceId: 'l1/2' }],
      });
    });

    it.each<[string, Parameters<typeof kindsRecording>[2]]>([
      ['a reply one kind short', { status: 'content', content: '{"kinds":["interpretation"]}' }],
      [
        'a reply one kind long',
        { status: 'content', content: JSON.stringify({ kinds: Array(5).fill('interpretation') }) },
      ],
      [
        'a kind outside the two',
        { status: 'content', content: '{"kinds":["fact","fact","fact","fact"]}' },
      ],
      ['a reply that is not JSON', { status: 'content', content: 'interpretation' }],
      ['a reply cut off at the token limit', { status: 'truncated', content: '{"kinds":["inter' }],
      ['a backend failure', { status: 'backend-failed', reason: 'connection refused' }],
    ])('reads %s as every neutral sentence a course claim', async (_, reply) => {
      const kinds = kindsRecording(NEUTRAL_ONES, retrieved, reply);
      await expect(verify([stage1, kinds], false, FIVE)).resolves.toEqual({
        status: 'verified',
        kept: [{ text: FIVE[1], slides: ['l1/1'], contradicts: [] }],
        withheld: NEUTRAL_ONES.map((text) => ({ reason: 'unsupported', text })),
      });
    });

    it('withholds an explanation whole as ungrounded when its kept sentences are only interpretations', async () => {
      const two = ['A worker is a bee of the working caste.', 'Cells are round.'];
      const recording = verifierRecording(
        two.flatMap((text) => pairsOf(text, retrieved)),
        [NEUTRAL, NEUTRAL, NEUTRAL, CONTRADICTED],
      );
      const kinds = kindsRecording([two[0] ?? ''], retrieved, ['interpretation']);
      await expect(verify([recording, kinds], false, two)).resolves.toEqual({
        status: 'verified',
        kept: [],
        withheld: [
          { reason: 'ungrounded', text: two[0] },
          { reason: 'contradicted', text: 'Cells are round.', sourceId: 'l1/2' },
        ],
      });
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
  ])(
    'reads a second opinion of %s on an over-length pair: only supported moves it, since an unrelated slide also earns unsupported',
    async (verdict, expected) => {
      const recordings = [
        judged(SENTENCE, retrieved, NEUTRAL, OVER_LENGTH),
        secondOpinion(comb, { verdict }),
        kindsRecording([SENTENCE], retrieved, ['course-claim']),
      ];
      await expect(verify(recordings, true)).resolves.toMatchObject(expected);
    },
  );

  it('keeps a sentence a second opinion supports beside a scored contradiction', async () => {
    const recordings = [
      judged(SENTENCE, retrieved, CONTRADICTED, OVER_LENGTH),
      secondOpinion(comb, { verdict: 'supported' }),
    ];
    await expect(verify(recordings, true)).resolves.toEqual({
      status: 'verified',
      kept: [{ text: SENTENCE, slides: ['l1/2'], contradicts: [] }],
      withheld: [],
    });
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
      verifyExplanation([SENTENCE], retrieved.map(slidePremise), {
        gateway: { generator, verifier: short },
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
        secondOpinion: false,
      }),
    ).rejects.toThrow('verifier returned 1 results for 2 pairs');
  });
});
