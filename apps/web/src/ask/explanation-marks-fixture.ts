import { type Explanation, SourceId } from '@cram/shared';
import { markExplanation } from './explanation-marks';

export const id = (value: string) => SourceId.parse(value);

/** A sentence: its text, its slides, and the ones it is marked against. */
type Row = readonly [string, readonly string[], (readonly string[])?];

export const explanation = (
  text: string,
  sentences: readonly Row[],
  quotes: readonly (readonly [string, string])[] = [],
): Explanation => ({
  text,
  quotes: quotes.map(([sourceId, quote]) => ({ sourceId: id(sourceId), quote })),
  sentences: sentences.map(([sentence, slides, contradicts = []]) => ({
    text: sentence,
    slides: slides.map(id),
    contradicts: contradicts.map(id),
  })),
  sources: [id('s1')],
});

/** Each sentence's runs, a quoted run written `[text|sourceId]`, `+` after the one its number follows. */
export const runs = (value: Explanation) =>
  markExplanation(value).map((sentence) =>
    sentence.runs
      .map(({ text, quote }) =>
        quote === undefined
          ? text
          : `[${text}|${quote.sourceIds.join(',')}${quote.ends ? '+' : ''}]`,
      )
      .join(''),
  );
