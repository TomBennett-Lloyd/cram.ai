import type { EntailmentResult, ModelGateway } from '@cram/gateway';
import type { AttributedSentence, RetrievedSlide, Verdict, WithheldSentence } from '@cram/shared';
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

/** Only `supported` moves a pair: the verifier prompt's `unsupported` is also an unrelated slide's verdict. */
const SECOND_OPINION: Readonly<Record<Verdict, ClaimLabel>> = {
  supported: 'entailed',
  partial: 'neutral',
  unsupported: 'neutral',
};

type SecondOpinion =
  | { readonly status: 'labelled'; readonly label: ClaimLabel }
  | Extract<DeepVerification, { status: 'model-failed' }>;

const overLengthLabel = async (
  pair: { readonly premise: string; readonly hypothesis: string },
  deps: DeepDeps,
): Promise<SecondOpinion> => {
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
  pairs: readonly { readonly premise: string; readonly hypothesis: string }[],
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

/** Stage 1 of `docs/adr/0009-explanation-answers.md` § Decision (d) as amended; a neutral sentence is a course claim until #424. */
export const verifyExplanation = async (
  sentences: readonly string[],
  retrieved: readonly RetrievedSlide[],
  deps: DeepDeps,
): Promise<DeepVerification> => {
  const pairs = sentences.flatMap((hypothesis) =>
    retrieved.map((slide) => ({ premise: slideText(slide.record), hypothesis })),
  );
  const results = await deps.gateway.verifier.entail({ pairs });
  if (results.length !== pairs.length)
    throw new Error(
      `verifier returned ${String(results.length)} results for ${String(pairs.length)} pairs`,
    );
  const kept: AttributedSentence[] = [];
  const cut: WithheldSentence[] = [];
  for (const [index, text] of sentences.entries()) {
    const from = index * retrieved.length;
    const span = [from, from + retrieved.length] as const;
    const sentence = await labelSentence(
      results.slice(...span),
      pairs.slice(...span),
      retrieved,
      deps,
    );
    if (sentence.status === 'model-failed') return sentence;
    const { labelled } = sentence;
    const entailing = labelled.filter(({ label }) => label === 'entailed');
    const contradicting = labelled.find(({ label }) => label === 'contradicted');
    if (entailing.length > 0)
      kept.push({ text, slides: entailing.map(({ slide }) => slide.sourceId), contradicts: [] });
    else if (contradicting !== undefined)
      cut.push({ reason: 'contradicted', text, sourceId: contradicting.slide.sourceId });
    else cut.push({ reason: 'unsupported', text });
  }
  const withheld =
    kept.length > 0
      ? cut
      : cut.map((entry): WithheldSentence =>
          entry.reason === 'contradicted' ? entry : { reason: 'ungrounded', text: entry.text },
        );
  return { status: 'verified', kept, withheld };
};
