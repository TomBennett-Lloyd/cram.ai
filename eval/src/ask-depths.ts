import type { ModelGateway, Verifier } from '@cram/gateway';
import {
  ask,
  contextPremises,
  contradictingSources,
  explain,
  PROVISIONAL_NLI_THRESHOLDS,
  slidePremise,
  VERIFICATION_DEPTH,
  type VerifierStrategy,
} from '@cram/grounding';
import { ATTRIBUTION_K } from '@cram/index';
import type { LoadedSummary, RetrievedSlide } from '@cram/shared';
import type { AskedQuestion } from './asked-question';
import type { PairTally } from './depth-rows';
import type { GoldenQuestion } from './golden-question';
import type { IndexRetriever } from './index-retriever';
import { type Clock, timed } from './latency';
import { forbiddenSentences } from './light-rows';

export interface Retrieved {
  readonly question: GoldenQuestion;
  readonly retrieved: readonly RetrievedSlide[];
}

export interface ToAsk extends Retrieved {
  readonly summaries: readonly LoadedSummary[];
}

const counting = (verifier: Verifier, tally: PairTally): Verifier => ({
  pin: verifier.pin,
  entail: async (request) => {
    tally.pairs += request.pairs.length;
    const results = await verifier.entail(request);
    tally.overLength += results.filter(({ status }) => status === 'over-length').length;
    return results;
  },
});

export interface Light {
  readonly asked: readonly AskedQuestion[];
  readonly durationsMs: readonly number[];
  readonly sent: PairTally;
}

export const askLight = async (
  retrievals: readonly ToAsk[],
  retriever: IndexRetriever,
  gateway: ModelGateway,
  clock: Clock,
): Promise<Light> => {
  const tally = { pairs: 0, overLength: 0 };
  const deps = {
    gateway: { generator: gateway.generator, verifier: counting(gateway.verifier, tally) },
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
    searchSentence: (sentence: string) => retriever.searchSentence(sentence, ATTRIBUTION_K),
  };
  const asked: AskedQuestion[] = [];
  const durationsMs: number[] = [];
  for (const { question, retrieved, summaries } of retrievals) {
    const result = await timed(
      clock,
      (ms) => durationsMs.push(ms),
      () => ask(question.question, { retrieved, summaries }, deps),
    );
    asked.push({ question, retrieved, result });
  }
  return { asked, durationsMs, sent: tally };
};

export interface Deep {
  readonly asked: readonly AskedQuestion[];
  /** One per question, in order. */
  readonly sent: readonly PairTally[];
}

export const askDeep = async (
  retrievals: readonly ToAsk[],
  gateway: ModelGateway,
  strategy: VerifierStrategy,
): Promise<Deep> => {
  const depth = { depth: VERIFICATION_DEPTH['revision-guide'], secondOpinion: strategy !== 'nli' };
  const asked: AskedQuestion[] = [];
  const sent: PairTally[] = [];
  for (const { question, retrieved, summaries } of retrievals) {
    const tally = { pairs: 0, overLength: 0 };
    const result = await explain(question.question, { retrieved, summaries }, depth, {
      gateway: { generator: gateway.generator, verifier: counting(gateway.verifier, tally) },
      thresholds: PROVISIONAL_NLI_THRESHOLDS,
    });
    asked.push({ question, retrieved, result });
    sent.push(tally);
  }
  return { asked, sent };
};

/** `lightFlagRateWide`'s pass: each forbidden sentence against the deep premises its prompt held, then each candidate beyond its raw slides. */
export const widened = async (
  light: readonly AskedQuestion[],
  gateway: ModelGateway,
): Promise<readonly AskedQuestion[]> => {
  const wide: AskedQuestion[] = [];
  for (const item of light) {
    const { result } = item;
    const forbidden = forbiddenSentences(item);
    if (result.status !== 'grounded' || forbidden.length === 0) {
      wide.push(item);
      continue;
    }
    const held = contextPremises(result.context);
    const raw = new Set(result.context.raw.map(({ sourceId }) => sourceId));
    const beyond = (ids: readonly string[]) =>
      result.slides
        .filter(({ sourceId }) => ids.includes(sourceId) && !raw.has(sourceId))
        .map(slidePremise);
    const contradicts = await contradictingSources(
      forbidden.map(({ sentence }) => ({
        text: sentence.text,
        premises: [...held, ...beyond(sentence.slides)],
      })),
      (request) => gateway.verifier.entail(request),
      PROVISIONAL_NLI_THRESHOLDS,
    );
    const sentences = result.explanation.sentences.map((sentence, index) => {
      const marked = contradicts[forbidden.findIndex((entry) => entry.index === index)];
      return marked === undefined ? sentence : { ...sentence, contradicts: [...marked] };
    });
    wide.push({
      ...item,
      result: { ...result, explanation: { ...result.explanation, sentences } },
    });
  }
  return wide;
};
