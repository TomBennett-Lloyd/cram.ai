import type { Citation, RetrievedSlide } from '@cram/shared';

/** One slide a unit cites, with every quote the unit takes from it. */
export interface CitedSlide {
  readonly slide: RetrievedSlide;
  readonly quotes: readonly string[];
}

/**
 * A unit's citations grouped by slide, in first-cited order. A citation naming no slide of the reply
 * breaks the reply's contract (`AskReply`), and is returned as missing rather than dropped.
 */
export const citedSlides = (
  citations: readonly Citation[],
  slides: readonly RetrievedSlide[],
): { readonly cited: readonly CitedSlide[]; readonly missing: number } => {
  const bySource = new Map<string, { slide: RetrievedSlide; quotes: string[] }>();
  let missing = 0;
  for (const { sourceId, quote } of citations) {
    const known = bySource.get(sourceId);
    const slide = known?.slide ?? slides.find((candidate) => candidate.sourceId === sourceId);
    if (slide === undefined) missing++;
    else if (known === undefined) bySource.set(sourceId, { slide, quotes: [quote] });
    else known.quotes.push(quote);
  }
  return { cited: [...bySource.values()], missing };
};
