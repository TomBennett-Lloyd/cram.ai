import { quoteResolves } from '@cram/grounding';
import { Citation } from '@cram/shared';
import { z } from 'zod';
import type { AskedQuestion } from './asked-question';
import { GoldenQuestion } from './golden-question';
import { absoluteFields, absoluteRow } from './metric-row';

export const CitationFailure = z.strictObject({
  question: GoldenQuestion.shape.question,
  quote: Citation,
});
export type CitationFailure = z.infer<typeof CitationFailure>;

export const CitationValidityRow = absoluteRow(CitationFailure);
export type CitationValidityRow = z.infer<typeof CitationValidityRow>;

export const citationValidity = (asked: readonly AskedQuestion[]): CitationValidityRow => {
  const failures: CitationFailure[] = [];
  let quotes = 0;
  for (const { question, retrieved, result } of asked) {
    if (result.status !== 'grounded') continue;
    for (const quote of result.explanation.quotes) {
      quotes += 1;
      if (!quoteResolves(quote, retrieved)) failures.push({ question: question.question, quote });
    }
  }
  return CitationValidityRow.parse(absoluteFields(quotes, failures, 'no quote was shown'));
};
