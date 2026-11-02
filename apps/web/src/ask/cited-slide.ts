import type { AttributedSentence, Citation, RetrievedSlide } from '@cram/shared';

/** One slide a sentence names, with every quote the explanation takes from it. */
export interface CitedSlide {
  readonly slide: RetrievedSlide;
  readonly quotes: readonly string[];
}

/**
 * A sentence's slides in its order, each with the explanation's quotes from it. A slide the reply
 * lacks breaks `AskReply`'s contract, and is counted as missing rather than dropped.
 */
export const sentenceSlides = (
  sentence: AttributedSentence,
  quotes: readonly Citation[],
  slides: readonly RetrievedSlide[],
): { readonly cited: readonly CitedSlide[]; readonly missing: number } => {
  const cited: CitedSlide[] = [];
  let missing = 0;
  for (const sourceId of sentence.slides) {
    const slide = slides.find((candidate) => candidate.sourceId === sourceId);
    if (slide === undefined) missing++;
    else
      cited.push({
        slide,
        quotes: quotes.filter((quote) => quote.sourceId === sourceId).map(({ quote }) => quote),
      });
  }
  return { cited, missing };
};
