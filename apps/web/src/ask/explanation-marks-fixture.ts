import { type Explanation, type SentenceStanding, SourceId } from '@cram/shared';
import { markExplanation } from './explanation-marks';

export const id = (value: string) => SourceId.parse(value);

/** A sentence: its text, its slides, the ones it is marked against, and its standing. */
type Row = readonly [string, readonly string[], (readonly string[])?, SentenceStanding?];

export const explanation = (
  text: string,
  sentences: readonly Row[],
  quotes: readonly (readonly [string, string])[] = [],
): Explanation => ({
  text,
  quotes: quotes.map(([sourceId, quote]) => ({ sourceId: id(sourceId), quote })),
  sentences: sentences.map(([sentence, slides, contradicts = [], standing = 'attributed']) => ({
    text: sentence,
    slides: slides.map(id),
    contradicts: contradicts.map(id),
    standing,
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
