import type { Verifier } from '@cram/gateway';
import type { AttributedSentence, SourceId } from '@cram/shared';
import type { SentenceSlides } from './attribute-sentences';
import { claimLabel, type NliThresholds } from './nli-verdict';
import { type Premise, scoredPremises, slidePremise } from './premise';

export interface SentencePremises {
  readonly text: string;
  readonly premises: readonly Premise[];
}

/** Each sentence's contradicting premises' first slides, best first (`docs/adr/0009-explanation-answers.md` § Decision (g), as amended); a throw is the caller's. */
export const contradictingSources = async (
  sentences: readonly SentencePremises[],
  entail: Verifier['entail'],
  thresholds: NliThresholds,
): Promise<readonly (readonly SourceId[])[]> => {
  const scored = sentences.map(({ text, premises }) => ({
    text,
    premises: scoredPremises(premises),
  }));
  const pairs = scored.flatMap(({ text, premises }) =>
    premises.map((premise) => ({ premise: premise.text, hypothesis: text })),
  );
  const results = pairs.length === 0 ? [] : await entail({ pairs });
  if (results.length !== pairs.length)
    throw new Error(
      `verifier returned ${String(results.length)} results for ${String(pairs.length)} pairs`,
    );
  let next = 0;
  return scored.map(({ premises }) => {
    const judged = premises.flatMap(({ sources: [named] }) => {
      const result = results[next++];
      return result?.status === 'scored' ? [{ sourceId: named, scores: result.scores }] : [];
    });
    if (judged.some(({ scores }) => scores.entailment >= thresholds.entailedAt)) return [];
    const contradicting = judged
      .filter(({ scores }) => claimLabel(scores, thresholds) === 'contradicted')
      .toSorted((a, b) => b.scores.contradiction - a.scores.contradiction)
      .map(({ sourceId }) => sourceId);
    return [...new Set(contradicting)];
  });
};

export const markContradictions = async (
  sentences: readonly SentenceSlides[],
  entail: Verifier['entail'],
  thresholds: NliThresholds,
): Promise<readonly AttributedSentence[]> => {
  const contradicts = await contradictingSources(
    sentences.map(({ text, slides }) => ({ text, premises: slides.map(slidePremise) })),
    entail,
    thresholds,
  );
  return sentences.map(({ text, slides }, index) => ({
    text,
    slides: slides.map(({ sourceId }) => sourceId),
    contradicts: [...(contradicts[index] ?? [])],
  }));
};
