import type { EntailmentResult, EntailRequest } from '@cram/gateway';
import { SourceId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { NEUTRAL, OVER_LENGTH, pairsOf, slide } from './fake-gateway-fixture';
import { contradictingSources, markContradictions } from './mark-contradictions';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import type { Premise } from './premise';

const { contradictedAt, entailedAt } = PROVISIONAL_NLI_THRESHOLDS;
const hive = slide('l1/1', 'Worker bees are male.');
const comb = slide('l1/2', 'Bees build comb from square cells.');
const winter = slide('l5/6', 'Bees sleep through the winter.');

const contradiction = (score: number): EntailmentResult => ({
  status: 'scored',
  scores: { entailment: 0, neutral: 1 - score, contradiction: score },
});

const entailment = (score: number): EntailmentResult => ({
  status: 'scored',
  scores: { entailment: score, neutral: 1 - score, contradiction: 0 },
});

/** An `entail` answering from `results` in order, recording every call. */
const scripted = (...results: EntailmentResult[]) => {
  const calls: EntailRequest[] = [];
  return {
    calls,
    entail: (request: EntailRequest) => {
      calls.push(request);
      return Promise.resolve(results.slice(0, request.pairs.length));
    },
  };
};

const mark = (
  sentences: Parameters<typeof markContradictions>[0],
  entail: ReturnType<typeof scripted>['entail'],
) => markContradictions(sentences, entail, PROVISIONAL_NLI_THRESHOLDS);

describe('markContradictions', () => {
  it('sends every sentence × its own single-line slides, one pair each, in one call', async () => {
    const verifier = scripted(NEUTRAL, NEUTRAL, NEUTRAL);
    const sentences = [
      { text: 'Workers are female.', slides: [hive, comb] },
      { text: 'Bees hibernate.', slides: [winter] },
    ];
    await mark(sentences, verifier.entail);
    expect(verifier.calls).toEqual([
      {
        pairs: [
          ...pairsOf('Workers are female.', [hive, comb]),
          ...pairsOf('Bees hibernate.', [winter]),
        ],
      },
    ]);
  });

  it('scores a sentence against a slide whole, then each of its lines, and a line that entails it clears the mark', async () => {
    const workers = slide('l1/3', 'Worker bees are male.\nWorkers forage.', {
      title: 'The workers',
    });
    const verifier = scripted(contradiction(0.99), NEUTRAL, entailment(entailedAt), NEUTRAL);
    await expect(
      mark([{ text: 'Workers are male.', slides: [workers] }], verifier.entail),
    ).resolves.toEqual([{ text: 'Workers are male.', slides: ['l1/3'], contradicts: [] }]);
    expect(verifier.calls[0]?.pairs.map(({ premise }) => premise)).toEqual([
      'The workers\nWorker bees are male.\nWorkers forage.',
      'The workers',
      'Worker bees are male.',
      'Workers forage.',
    ]);
  });

  it('makes no call when no sentence has a slide', async () => {
    const verifier = scripted();
    await expect(mark([{ text: 'Bees hibernate.', slides: [] }], verifier.entail)).resolves.toEqual(
      [{ text: 'Bees hibernate.', slides: [], contradicts: [] }],
    );
    expect(verifier.calls).toEqual([]);
  });

  it('marks a pair at exactly contradictedAt, and not one just below it', async () => {
    const verifier = scripted(contradiction(contradictedAt), contradiction(contradictedAt - 0.001));
    const [marked] = await mark(
      [{ text: 'Workers are female.', slides: [hive, comb] }],
      verifier.entail,
    );
    expect(marked?.contradicts).toEqual(['l1/1']);
  });

  it('orders two contradicting slides by score, best first, whatever their order in slides', async () => {
    const verifier = scripted(contradiction(0.7), NEUTRAL, contradiction(0.95));
    const [marked] = await mark(
      [{ text: 'Workers are female.', slides: [hive, comb, winter] }],
      verifier.entail,
    );
    expect(marked).toEqual({
      text: 'Workers are female.',
      slides: ['l1/1', 'l1/2', 'l5/6'],
      contradicts: ['l5/6', 'l1/1'],
    });
  });

  it('marks nothing on a sentence one of its slides entails, whatever the others score', async () => {
    const verifier = scripted(contradiction(0.99), entailment(entailedAt));
    const [marked] = await mark(
      [{ text: 'Workers are female.', slides: [hive, comb] }],
      verifier.entail,
    );
    expect(marked?.contradicts).toEqual([]);
  });

  it('marks a sentence whose best entailment is just below entailedAt', async () => {
    const verifier = scripted(contradiction(0.99), entailment(entailedAt - 0.001));
    const [marked] = await mark(
      [{ text: 'Workers are female.', slides: [hive, comb] }],
      verifier.entail,
    );
    expect(marked?.contradicts).toEqual(['l1/1']);
  });

  it('keeps slides order between equal scores', async () => {
    const verifier = scripted(contradiction(0.8), contradiction(0.8));
    const [marked] = await mark(
      [{ text: 'Workers are female.', slides: [comb, hive] }],
      verifier.entail,
    );
    expect(marked?.contradicts).toEqual(['l1/2', 'l1/1']);
  });

  it('marks nothing from an over-length pair', async () => {
    const verifier = scripted(OVER_LENGTH, contradiction(0.9));
    const marked = await mark(
      [
        { text: 'Workers are female.', slides: [hive] },
        { text: 'Bees hibernate.', slides: [winter] },
      ],
      verifier.entail,
    );
    expect(marked.map(({ contradicts }) => contradicts)).toEqual([[], ['l5/6']]);
  });

  it('marks a candidate the question’s retrieval never fetched', async () => {
    const verifier = scripted(NEUTRAL, contradiction(0.9));
    const [marked] = await mark(
      [{ text: 'Bees forage all winter.', slides: [hive, winter] }],
      verifier.entail,
    );
    expect(marked?.contradicts).toEqual(['l5/6']);
  });

  it('throws when the verifier answers a different number of pairs', async () => {
    const short = { entail: () => Promise.resolve([NEUTRAL]) };
    await expect(
      mark([{ text: 'Workers are female.', slides: [hive, comb] }], short.entail),
    ).rejects.toThrow('verifier returned 1 results for 2 pairs');
  });
});

describe('contradictingSources', () => {
  const premise = (text: string, first: string, ...rest: string[]): Premise => ({
    text,
    lines: [text],
    sources: [SourceId.parse(first), ...rest.map((id) => SourceId.parse(id))],
  });
  const sentence = 'Drones are female.';

  it('names each contradicting premise’s first slide once, best-scoring first', async () => {
    const { entail, calls } = scripted(
      contradiction(0.95),
      contradiction(0.99),
      contradiction(0.97),
    );
    const premises = [
      premise('Drones are the males.', 'l1/3', 'l1/4'),
      premise('Every drone is male.', 'l2/1'),
      premise('The males are drones.', 'l1/3'),
    ];
    await expect(
      contradictingSources([{ text: sentence, premises }], entail, PROVISIONAL_NLI_THRESHOLDS),
    ).resolves.toEqual([['l2/1', 'l1/3']]);
    expect(calls[0]?.pairs).toEqual(
      premises.map(({ text }) => ({ premise: text, hypothesis: sentence })),
    );
  });

  it('names none when any premise entails the sentence', async () => {
    const { entail } = scripted(contradiction(0.99), entailment(entailedAt));
    await expect(
      contradictingSources(
        [{ text: sentence, premises: [premise('a', 'l1/3'), premise('b', 'l2/1')] }],
        entail,
        PROVISIONAL_NLI_THRESHOLDS,
      ),
    ).resolves.toEqual([[]]);
  });
});
