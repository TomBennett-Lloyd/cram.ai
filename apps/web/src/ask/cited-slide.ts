import type { Citation, RetrievedSlide, SourceId } from '@cram/shared';

/** One slide an explanation names, with every quote it takes from it, and the sentence it is opened from as contradicting. */
export interface CitedSlide {
  readonly slide: RetrievedSlide;
  readonly quotes: readonly string[];
  readonly contradicted?: string;
}

/** `undefined` for a slide the reply lacks, which breaks `AskReply`'s contract and is shown as missing. */
export const citedSlide = (
  sourceId: SourceId,
  quotes: readonly Citation[],
  slides: readonly RetrievedSlide[],
): CitedSlide | undefined => {
  const slide = slides.find((candidate) => candidate.sourceId === sourceId);
  return slide === undefined
    ? undefined
    : {
        slide,
        quotes: quotes.filter((quote) => quote.sourceId === sourceId).map(({ quote }) => quote),
      };
};
