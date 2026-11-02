import type { EntailmentPair, EntailmentResult, ModelGateway } from '@cram/gateway';
import type { AttributedSentence, RetrievedSlide, Verdict, WithheldSentence } from '@cram/shared';
import { classifySentenceKinds } from './classify-sentence-kinds';
import type { ModelFailure } from './model-failure';
import { type ClaimLabel, claimLabel, type NliThresholds } from './nli-verdict';
import { verifierRequest } from './prompts/verifier-prompt';
import { slideText } from './slide-text';

export interface DeepDeps {
  readonly gateway: Pick<ModelGateway, 'generator' | 'verifier'>;
  readonly thresholds: NliThresholds;
  readonly secondOpinion: boolean;
}

export type DeepVerification =
  | {
      readonly status: 'verified';
      readonly kept: readonly AttributedSentence[];
      readonly withheld: readonly WithheldSentence[];
    }
  | { readonly status: 'model-failed'; readonly failure: ModelFailure };

const SECOND_OPINION: Readonly<Record<Verdict, ClaimLabel>> = {
  supported: 'entailed',
  partial: 'neutral',
  unsupported: 'neutral',
};

type SecondOpinion =
  | { readonly status: 'labelled'; readonly label: ClaimLabel }
  | Extract<DeepVerification, { status: 'model-failed' }>;

const overLengthLabel = async (pair: EntailmentPair, deps: DeepDeps): Promise<SecondOpinion> => {
  if (!deps.secondOpinion) return { status: 'labelled', label: 'contradicted' };
  const reply = await deps.gateway.generator.chat(
    verifierRequest({ text: pair.hypothesis, quotes: [pair.premise] }),
  );
  return reply.status === 'completed'
    ? { status: 'labelled', label: SECOND_OPINION[reply.value.verdict] }
    : { status: 'model-failed', failure: reply };
};

interface Labelled {
  readonly slide: RetrievedSlide;
  readonly label: ClaimLabel;
}

const labelSentence = async (
  results: readonly EntailmentResult[],
  pairs: readonly EntailmentPair[],
  retrieved: readonly RetrievedSlide[],
  deps: DeepDeps,
): Promise<
  | { readonly status: 'labelled'; readonly labelled: readonly Labelled[] }
  | Extract<DeepVerification, { status: 'model-failed' }>
> => {
  const scored = retrieved.map((slide, at) => {
    const result = results[at];
    if (result === undefined) throw new Error('verifyExplanation: no pair');
    return { slide, result };
  });
  const entails = ({ result }: (typeof scored)[number]) =>
    result.status === 'scored' && result.scores.entailment >= deps.thresholds.entailedAt;
  if (scored.some(entails))
    return {
      status: 'labelled',
      labelled: scored.filter(entails).map(({ slide }) => ({ slide, label: 'entailed' as const })),
    };
  const labelled: Labelled[] = [];
  for (const [at, { slide, result }] of scored.entries()) {
    const pair = pairs[at];
    if (pair === undefined) throw new Error('verifyExplanation: no pair');
    if (result.status === 'scored') {
      labelled.push({ slide, label: claimLabel(result.scores, deps.thresholds) });
      continue;
    }
    const opinion = await overLengthLabel(pair, deps);
    if (opinion.status === 'model-failed') return opinion;
    labelled.push({ slide, label: opinion.label });
  }
  return { status: 'labelled', labelled };
};

type Stage1 =
  | { readonly label: 'entailed'; readonly slides: readonly RetrievedSlide[] }
  | { readonly label: 'contradicted'; readonly slide: RetrievedSlide }
  | { readonly label: 'neutral' };

type Outcome = { readonly kept: AttributedSentence } | { readonly cut: WithheldSentence };

const stage1 = (labelled: readonly Labelled[]): Stage1 => {
  const entailing = labelled.filter(({ label }) => label === 'entailed');
  if (entailing.length > 0)
    return { label: 'entailed', slides: entailing.map(({ slide }) => slide) };
  const contradicting = labelled.find(({ label }) => label === 'contradicted');
  return contradicting === undefined
    ? { label: 'neutral' }
    : { label: 'contradicted', slide: contradicting.slide };
};

/** `docs/adr/0009-explanation-answers.md` § Decision (d) as amended: Stage 1 over every retrieved slide, then Stage 2 over the neutral sentences. */
export const verifyExplanation = async (
  sentences: readonly string[],
  retrieved: readonly RetrievedSlide[],
  deps: DeepDeps,
): Promise<DeepVerification> => {
  const premises = retrieved.map((slide) => slideText(slide.record));
  const pairs = sentences.flatMap((hypothesis) =>
    premises.map((premise) => ({ premise, hypothesis })),
  );
  const results = await deps.gateway.verifier.entail({ pairs });
  if (results.length !== pairs.length)
    throw new Error(
      `verifier returned ${String(results.length)} results for ${String(pairs.length)} pairs`,
    );
  const verdicts: Stage1[] = [];
  for (const index of sentences.keys()) {
    const from = index * retrieved.length;
    const span = [from, from + retrieved.length] as const;
    const sentence = await labelSentence(
      results.slice(...span),
      pairs.slice(...span),
      retrieved,
      deps,
    );
    if (sentence.status === 'model-failed') return sentence;
    verdicts.push(stage1(sentence.labelled));
  }
  const neutral = sentences.flatMap((text, index) =>
    verdicts[index]?.label === 'neutral' ? [{ text, index }] : [],
  );
  const kinds = await classifySentenceKinds(
    neutral.map(({ text }) => text),
    premises,
    deps.gateway.generator,
  );
  const kindOf = new Map(neutral.map(({ index }, at) => [index, kinds[at]]));
  const outcomes = sentences.map((text, index): Outcome => {
    const verdict = verdicts[index];
    if (verdict === undefined) throw new Error('verifyExplanation: no verdict');
    if (verdict.label === 'entailed')
      return {
        kept: { text, slides: verdict.slides.map(({ sourceId }) => sourceId), contradicts: [] },
      };
    if (verdict.label === 'contradicted')
      return { cut: { reason: 'contradicted', text, sourceId: verdict.slide.sourceId } };
    return kindOf.get(index) === 'interpretation'
      ? { kept: { text, slides: [], contradicts: [] } }
      : { cut: { reason: 'unsupported', text } };
  });
  if (verdicts.some(({ label }) => label === 'entailed'))
    return {
      status: 'verified',
      kept: outcomes.flatMap((outcome) => ('kept' in outcome ? [outcome.kept] : [])),
      withheld: outcomes.flatMap((outcome) => ('cut' in outcome ? [outcome.cut] : [])),
    };
  return {
    status: 'verified',
    kept: [],
    withheld: outcomes.map((outcome): WithheldSentence =>
      'cut' in outcome && outcome.cut.reason === 'contradicted'
        ? outcome.cut
        : { reason: 'ungrounded', text: 'kept' in outcome ? outcome.kept.text : outcome.cut.text },
    ),
  };
};
