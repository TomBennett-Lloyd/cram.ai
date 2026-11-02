import type { Verifier } from '@cram/gateway';
import type { AttributedSentence } from '@cram/shared';
import type { SentenceSlides } from './attribute-sentences';
import { claimLabel, type NliThresholds } from './nli-verdict';
import { slideText } from './slide-text';

/** The light depth's mark (`docs/adr/0009-explanation-answers.md` § Decision (g), as amended: an entailing slide outweighs any contradiction); a throw is the caller's. */
export const markContradictions = async (
  sentences: readonly SentenceSlides[],
  entail: Verifier['entail'],
  thresholds: NliThresholds,
): Promise<readonly AttributedSentence[]> => {
  const pairs = sentences.flatMap(({ text, slides }) =>
    slides.map((slide) => ({ premise: slideText(slide.record), hypothesis: text })),
  );
  const results = pairs.length === 0 ? [] : await entail({ pairs });
  if (results.length !== pairs.length)
    throw new Error(
      `verifier returned ${String(results.length)} results for ${String(pairs.length)} pairs`,
    );
  let next = 0;
  return sentences.map(({ text, slides }) => {
    const scored = slides.flatMap((slide) => {
      const result = results[next++];
      return result?.status === 'scored'
        ? [{ sourceId: slide.sourceId, scores: result.scores }]
        : [];
    });
    const entailed = scored.some(({ scores }) => scores.entailment >= thresholds.entailedAt);
    const contradicting = entailed
      ? []
      : scored.filter(({ scores }) => claimLabel(scores, thresholds) === 'contradicted');
    return {
      text,
      slides: slides.map((slide) => slide.sourceId),
      contradicts: contradicting
        .toSorted((a, b) => b.scores.contradiction - a.scores.contradiction)
        .map(({ sourceId }) => sourceId),
    };
  });
};
