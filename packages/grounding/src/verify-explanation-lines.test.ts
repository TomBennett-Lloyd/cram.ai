import type { EntailmentResult, Recording } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import {
  CONTRADICTED,
  ENTAILED,
  fakeGateway,
  kindsRecording,
  NEUTRAL,
  pairsOf,
  slide,
  verifierRecording,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { slidePremise } from './premise';
import { slideText } from './slide-text';
import { verifyExplanation } from './verify-explanation';

const SENTENCE = 'Workers are male.';

describe('verifyExplanation over a slide of several lines', () => {
  const workers = slide('l1/3', 'Worker bees are male.\nWorkers forage.', {
    title: 'The workers',
  });
  const NECTAR = 'So a worker gathers nectar.';
  const stage1 = (sentences: readonly string[], ...results: EntailmentResult[]) =>
    verifierRecording(
      sentences.flatMap((sentence) => pairsOf(sentence, [workers])),
      results,
    );
  const run = (recordings: readonly Recording[], sentences = [SENTENCE]) =>
    verifyExplanation(sentences, [slidePremise(workers)], {
      gateway: fakeGateway(recordings),
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
      secondOpinion: false,
    });

  it('sends the sentence against the slide whole, then each of its lines', async () => {
    const sent = [
      slideText(workers.record),
      'The workers',
      'Worker bees are male.',
      'Workers forage.',
    ].map((premise) => ({ premise, hypothesis: SENTENCE }));
    await expect(
      run([verifierRecording(sent, [NEUTRAL, NEUTRAL, ENTAILED, NEUTRAL])]),
    ).resolves.toMatchObject({ kept: [{ text: SENTENCE, slides: ['l1/3'] }] });
  });

  it('keeps a sentence one of its lines entails though the whole slide does not, crediting the slide', async () => {
    await expect(run([stage1([SENTENCE], NEUTRAL, NEUTRAL, ENTAILED, NEUTRAL)])).resolves.toEqual({
      status: 'verified',
      kept: [{ text: SENTENCE, slides: ['l1/3'], contradicts: [] }],
      withheld: [],
    });
  });

  it('cuts a sentence a line contradicts and none entails, naming the slide', async () => {
    await expect(
      run([stage1([SENTENCE], NEUTRAL, NEUTRAL, NEUTRAL, CONTRADICTED)]),
    ).resolves.toMatchObject({
      withheld: [{ reason: 'contradicted', sourceId: 'l1/3' }],
    });
  });

  it('shows the sentence-kind judge the slide whole, never its lines', async () => {
    const kinds = kindsRecording([NECTAR], [workers], ['interpretation']);
    const scored = stage1(
      [SENTENCE, NECTAR],
      ...[ENTAILED, NEUTRAL, NEUTRAL, NEUTRAL],
      ...[NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL],
    );
    await expect(run([scored, kinds], [SENTENCE, NECTAR])).resolves.toMatchObject({
      kept: [{ text: SENTENCE }, { text: NECTAR, slides: [] }],
    });
  });
});
