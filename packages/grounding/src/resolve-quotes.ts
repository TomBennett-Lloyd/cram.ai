import { type Citation, quoteSpan, type RetrievedSlide, type WithheldSentence } from '@cram/shared';
import type { LineCitation } from './prompts/generation-prompt';
import { slideLines } from './slide-text';

export interface QuoteResolution {
  readonly quotes: readonly Citation[];
  readonly withheld: readonly WithheldSentence[];
}

/**
 * Each quote pointer looked up as a retrieved slide's line, kept only if that line occurs in
 * `text`; a failing pointer is withheld as `dangling-citation` and its sentence keeps every word
 * (`docs/adr/0009-explanation-answers.md` § Decision (c)). A pointer naming no line is shown as
 * the prompt numbers it, `[n]`.
 */
export const resolveQuotes = (
  text: string,
  pointers: readonly LineCitation[],
  retrieved: readonly RetrievedSlide[],
): QuoteResolution => {
  const quotes: Citation[] = [];
  const withheld: WithheldSentence[] = [];
  for (const { sourceId, line } of pointers) {
    const record = retrieved.find((slide) => slide.sourceId === sourceId)?.record;
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
  return { quotes, withheld };
};
