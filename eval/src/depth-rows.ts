import { quotesIn, spansOf } from '@cram/grounding';
import { z } from 'zod';
import { type AskedQuestion, shownSentences } from './asked-question';
import { BaselineRow, baselineRow } from './metric-row';

const Count = z.number().int().nonnegative();

/** One depth's rows (`docs/adr/0009-explanation-answers.md` § Decision (o)); `explanationEntailed` is the deep depth's. */
export const DepthRows = z.strictObject({
  explanationWithheld: BaselineRow,
  explanationEntailed: BaselineRow.optional(),
  quotedShare: BaselineRow,
});
export type DepthRows = z.infer<typeof DepthRows>;

/** What attribution and the mark cost per chat answer (#366's A14). */
export const AttributionCounts = z.strictObject({
  answers: Count,
  sentences: Count,
  pairs: Count,
  overLengthPairs: Count,
});
export type AttributionCounts = z.infer<typeof AttributionCounts>;

const withheldSentences = ({ result }: AskedQuestion): number =>
  result.status === 'model-failed'
    ? 0
    : result.withheld.filter(({ reason }) => reason !== 'dangling-citation').length;

/** Of the sentences written, those withheld; a dropped pointer is not a sentence. */
export const explanationWithheld = (asked: readonly AskedQuestion[]): BaselineRow => {
  const withheld = asked.reduce((sum, item) => sum + withheldSentences(item), 0);
  const shown = asked.reduce((sum, { result }) => sum + shownSentences(result).length, 0);
  return baselineRow(withheld, withheld + shown, 'no explanation was written');
};

export const explanationEntailed = (asked: readonly AskedQuestion[]): BaselineRow => {
  const shown = asked.flatMap(({ result }) => shownSentences(result));
  const entailed = shown.filter(({ slides }) => slides.length > 0);
  return baselineRow(entailed.length, shown.length, 'no sentence was shown');
};

export const quotedShare = (asked: readonly AskedQuestion[]): BaselineRow => {
  let shown = 0;
  let quoted = 0;
  for (const { result } of asked) {
    if (result.status !== 'grounded') continue;
    const { text, sentences, quotes } = result.explanation;
    for (const span of spansOf(
      text,
      sentences.map((sentence) => sentence.text),
    )) {
      shown += 1;
      if (quotesIn(text, span, quotes).length > 0) quoted += 1;
    }
  }
  return baselineRow(quoted, shown, 'no sentence was shown');
};

export const attributionCounts = (
  asked: readonly AskedQuestion[],
  overLengthPairs: number,
): AttributionCounts => {
  const sentences = asked.flatMap(({ result }) => shownSentences(result));
  return {
    answers: asked.filter(({ result }) => result.status === 'grounded').length,
    sentences: sentences.length,
    pairs: sentences.reduce((sum, { slides }) => sum + slides.length, 0),
    overLengthPairs,
  };
};
