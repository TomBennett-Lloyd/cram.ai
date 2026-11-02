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

type PairLabel =
  | { readonly status: 'labelled'; readonly label: ClaimLabel }
  | Extract<DeepVerification, { status: 'model-failed' }>;

const labelOf = async (
  result: EntailmentResult,
  pair: { readonly premise: string; readonly hypothesis: string },
  deps: DeepDeps,
): Promise<PairLabel> => {
  if (result.status === 'scored')
    return { status: 'labelled', label: claimLabel(result.scores, deps.thresholds) };
  if (!deps.secondOpinion) return { status: 'labelled', label: 'contradicted' };
  const reply = await deps.gateway.generator.chat(
    verifierRequest({ text: pair.hypothesis, quotes: [pair.premise] }),
  );
  return reply.status === 'completed'
    ? { status: 'labelled', label: SECOND_OPINION[reply.value.verdict] }
    : { status: 'model-failed', failure: reply };
};

/** Stage 1 of `docs/adr/0009-explanation-answers.md` § Decision (d); a neutral sentence is a course claim until #424. */
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
    const labelled: { readonly slide: RetrievedSlide; readonly label: ClaimLabel }[] = [];
    for (const [offset, slide] of retrieved.entries()) {
      const at = index * retrieved.length + offset;
      const [result, pair] = [results[at], pairs[at]];
      if (result === undefined || pair === undefined) throw new Error('verifyExplanation: no pair');
      const label = await labelOf(result, pair, deps);
      if (label.status === 'model-failed') return label;
      labelled.push({ slide, label: label.label });
    }
    const contradicting = labelled.find(({ label }) => label === 'contradicted');
    const entailing = labelled.filter(({ label }) => label === 'entailed');
    if (contradicting !== undefined)
      cut.push({ reason: 'contradicted', text, sourceId: contradicting.slide.sourceId });
    else if (entailing.length > 0)
      kept.push({ text, slides: entailing.map(({ slide }) => slide.sourceId), contradicts: [] });
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
