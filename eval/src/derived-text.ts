import type { z } from 'zod';
import { SlideRef } from './golden-question';
import { absoluteFields, absoluteRow, type BaselineRow, baselineRow } from './metric-row';

/** The one tokeniser of ADR 0006 § Decision (h): lower-cased, punctuation stripped, whitespace-split. */
export const derivedTextTokens = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/\p{P}/gu, '')
    .split(/\s+/)
    .filter((token) => token !== '');

export const DerivedCoverageRow = absoluteRow(SlideRef);
export type DerivedCoverageRow = z.infer<typeof DerivedCoverageRow>;

export interface ImageOnlySlide {
  readonly ref: SlideRef;
  readonly derived: boolean;
}

/** Of the `imageOnly` slides, those whose record is derived; each miss is listed. */
export const derivedTextCoverage = (slides: readonly ImageOnlySlide[]): DerivedCoverageRow =>
  DerivedCoverageRow.parse(
    absoluteFields(
      slides.length,
      slides.filter(({ derived }) => !derived).map(({ ref }) => ref),
      'the deck has no imageOnly slide',
    ),
  );

export interface DerivedPair {
  readonly trueText: string;
  readonly derivedText: string;
}

export interface DerivedTextAccuracy {
  readonly recall: BaselineRow;
  readonly precision: BaselineRow;
}

const tally = (tokens: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};

/** Tokens both sides hold, each counted at most as often as the scarcer side holds it. */
const shared = (a: readonly string[], b: readonly string[]): number => {
  const inB = tally(b);
  let count = 0;
  for (const [token, n] of tally(a)) count += Math.min(n, inB.get(token) ?? 0);
  return count;
};

/** Recall and precision pooled over the slides. */
export const derivedTextAccuracy = (pairs: readonly DerivedPair[]): DerivedTextAccuracy => {
  let matched = 0;
  let trueTokens = 0;
  let derivedTokens = 0;
  for (const { trueText, derivedText } of pairs) {
    const truth = derivedTextTokens(trueText);
    const derived = derivedTextTokens(derivedText);
    matched += shared(truth, derived);
    trueTokens += truth.length;
    derivedTokens += derived.length;
  }
  return {
    recall: baselineRow(matched, trueTokens, 'no true text to recall'),
    precision: baselineRow(matched, derivedTokens, 'no derived text'),
  };
};
