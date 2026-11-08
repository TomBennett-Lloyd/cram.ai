import { type Citation, quoteSpan, type RetrievedSlide, type WithheldSentence } from '@cram/shared';
import type { LineCitation } from './prompts/generation-prompt';
import { slideLines } from './slide-text';

export interface QuoteResolution {
  readonly quotes: readonly Citation[];
  readonly withheld: readonly WithheldSentence[];
}

/** A line of fewer words is a heading or label, never marked unlisted (#679's probe; `docs/adr/0009-explanation-answers.md` § Decision (c)). */
export const FOUND_QUOTE_MIN_WORDS = 4;

const isListed = (quotes: readonly Citation[], sourceId: Citation['sourceId'], quote: string) =>
  quotes.some((listed) => listed.sourceId === sourceId && listed.quote === quote);

const foundQuotes = (
  text: string,
  slides: readonly RetrievedSlide[],
  listed: readonly Citation[],
): Citation[] => {
  const found: Citation[] = [];
  for (const { sourceId, record } of slides)
    for (const quote of slideLines(record))
      if (
        quote.split(/\s+/).length >= FOUND_QUOTE_MIN_WORDS &&
        quoteSpan(text, quote) !== undefined &&
        !isListed([...listed, ...found], sourceId, quote)
      )
        found.push({ sourceId, quote });
  return found;
};

/**
 * Each quote pointer looked up as a line of one of `slides`, kept only if that line occurs in
 * `text`, then every unlisted line of `slides` of `FOUND_QUOTE_MIN_WORDS` or more that `text`
 * repeats; a failing pointer is withheld as `dangling-citation`, shown as `[n]` if it names no
 * line, and its sentence keeps every word (`docs/adr/0009-explanation-answers.md` § Decision (c)).
 */
export const resolveQuotes = (
  text: string,
  pointers: readonly LineCitation[],
  slides: readonly RetrievedSlide[],
): QuoteResolution => {
  const quotes: Citation[] = [];
  const withheld: WithheldSentence[] = [];
  for (const { sourceId, line } of pointers) {
    const record = slides.find((slide) => slide.sourceId === sourceId)?.record;
    const quote = record === undefined ? undefined : slideLines(record)[line - 1];
    if (quote !== undefined && quoteSpan(text, quote) !== undefined)
      quotes.push({ sourceId, quote });
    else
      withheld.push({
        reason: 'dangling-citation',
        text: quote ?? `[${String(line)}]`,
        sourceId,
      });
  }
  return { quotes: [...quotes, ...foundQuotes(text, slides, quotes)], withheld };
};
