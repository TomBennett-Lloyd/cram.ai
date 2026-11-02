import { type Citation, quoteSpan, type RetrievedSlide, type SourceId } from '@cram/shared';
import type { ClaimSpan } from './claims';

export interface SentenceSlides {
  readonly text: string;
  readonly slides: readonly RetrievedSlide[];
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

const unique = <T>(items: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    if (seen.has(key(item))) continue;
    seen.add(key(item));
    kept.push(item);
  }
  return kept;
};

export const uniqueSlides = (slides: readonly RetrievedSlide[]): RetrievedSlide[] =>
  unique(slides, (slide) => slide.sourceId);

export const quotesIn = (
  text: string,
  sentence: ClaimSpan,
  quotes: readonly Citation[],
): readonly Citation[] =>
  quotes.filter((quote) => {
    const span = quoteSpan(text, quote.quote);
    return span !== undefined && overlaps(span, sentence);
  });

/** Light-depth slides per sentence: its candidates, then its quoted slides (`docs/adr/0009-explanation-answers.md` § Decision (f)). */
export const attributeSentences = (
  text: string,
  sentences: readonly ClaimSpan[],
  candidates: readonly (readonly RetrievedSlide[])[],
  quotes: readonly Citation[],
  retrieved: readonly RetrievedSlide[],
): readonly SentenceSlides[] =>
  sentences.map((sentence, index) => {
    const quoted = quotesIn(text, sentence, quotes).flatMap(
      (quote) => retrieved.find((slide) => slide.sourceId === quote.sourceId) ?? [],
    );
    return {
      text: sentence.text,
      slides: uniqueSlides([...(candidates[index] ?? []), ...quoted]),
    };
  });

/** First use, sentence by sentence (§ Decision (i)). */
export const sourcesOf = (named: readonly (readonly SourceId[])[]): readonly SourceId[] =>
  unique(named.flat(), (id) => id);
