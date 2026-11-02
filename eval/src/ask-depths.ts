import type { ModelGateway, Verifier } from '@cram/gateway';
import {
  ask,
  explain,
  markContradictions,
  PROVISIONAL_NLI_THRESHOLDS,
  VERIFICATION_DEPTH,
  type VerifierStrategy,
} from '@cram/grounding';
import { ATTRIBUTION_K } from '@cram/index';
import type { RetrievedSlide } from '@cram/shared';
import type { AskedQuestion } from './asked-question';
import type { GoldenQuestion } from './golden-question';
import type { IndexRetriever } from './index-retriever';
import { type Clock, timed } from './latency';
import { forbiddenSentences } from './light-rows';

export interface Retrieved {
  readonly question: GoldenQuestion;
  readonly retrieved: readonly RetrievedSlide[];
}

/** The light run's verifier, counting the over-length pairs the mark skips (#366's A14). */
const counting = (verifier: Verifier, tally: { overLength: number }): Verifier => ({
  pin: verifier.pin,
  entail: async (request) => {
    const results = await verifier.entail(request);
    tally.overLength += results.filter(({ status }) => status === 'over-length').length;
    return results;
  },
});

export interface Light {
  readonly asked: readonly AskedQuestion[];
  readonly durationsMs: readonly number[];
  readonly overLengthPairs: number;
}

export const askLight = async (
  retrievals: readonly Retrieved[],
  retriever: IndexRetriever,
  gateway: ModelGateway,
  clock: Clock,
): Promise<Light> => {
  const tally = { overLength: 0 };
  const deps = {
    gateway: { generator: gateway.generator, verifier: counting(gateway.verifier, tally) },
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
    searchSentence: (sentence: string) => retriever.searchSentence(sentence, ATTRIBUTION_K),
  };
  const asked: AskedQuestion[] = [];
  const durationsMs: number[] = [];
  for (const { question, retrieved } of retrievals) {
    const result = await timed(
      clock,
      (ms) => durationsMs.push(ms),
      () => ask(question.question, retrieved, deps),
    );
    asked.push({ question, retrieved, result });
  }
  return { asked, durationsMs, overLengthPairs: tally.overLength };
};

export const askDeep = async (
  retrievals: readonly Retrieved[],
  gateway: ModelGateway,
  strategy: VerifierStrategy,
): Promise<readonly AskedQuestion[]> => {
  const depth = { depth: VERIFICATION_DEPTH['revision-guide'], secondOpinion: strategy !== 'nli' };
  const asked: AskedQuestion[] = [];
  for (const { question, retrieved } of retrievals) {
    const result = await explain(question.question, retrieved, depth, {
      gateway,
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
    });
    asked.push({ question, retrieved, result });
  }
  return asked;
};

/** `lightFlagRateWide`'s pass: each forbidden sentence against the retrieved set beside its candidates. */
export const widened = async (
  light: readonly AskedQuestion[],
  gateway: ModelGateway,
): Promise<readonly AskedQuestion[]> => {
  const wide: AskedQuestion[] = [];
  for (const item of light) {
    const { result, retrieved } = item;
    const forbidden = forbiddenSentences(item);
    if (result.status !== 'grounded' || forbidden.length === 0) {
      wide.push(item);
      continue;
    }
    const slidesOf = (ids: readonly string[]) =>
      result.slides.filter(({ sourceId }) => ids.includes(sourceId));
    const marked = await markContradictions(
      forbidden.map(({ sentence }) => ({
        text: sentence.text,
        slides: [
          ...retrieved,
          ...slidesOf(sentence.slides).filter(
            ({ sourceId }) => !retrieved.some((slide) => slide.sourceId === sourceId),
          ),
        ],
      })),
      (request) => gateway.verifier.entail(request),
      PROVISIONAL_NLI_THRESHOLDS,
    );
    const sentences = result.explanation.sentences.map((sentence, index) => {
      const at = forbidden.findIndex((entry) => entry.index === index);
      const mark = marked[at];
      return mark === undefined ? sentence : { ...sentence, contradicts: mark.contradicts };
    });
    wide.push({
      ...item,
      result: { ...result, explanation: { ...result.explanation, sentences } },
    });
  }
  return wide;
};
