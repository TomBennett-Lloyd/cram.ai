import type { LoadedSummary, RetrievedSlide, SourceId } from '@cram/shared';
import type { AssembledContext } from './assemble-context';
import { slideLines, slideText } from './slide-text';

/** A text a sentence is scored against, its lines, and the slides it credits (`docs/adr/0009-explanation-answers.md` § Decision (d)). */
export interface Premise {
  readonly text: string;
  readonly lines: readonly string[];
  readonly sources: readonly [SourceId, ...SourceId[]];
}

export const slidePremise = ({ sourceId, record }: RetrievedSlide): Premise => ({
  text: slideText(record),
  lines: slideLines(record),
  sources: [sourceId],
});

export const summaryPremises = (summaries: readonly LoadedSummary[]): readonly Premise[] =>
  summaries.flatMap(({ summary }) =>
    summary.units.flatMap(({ text, citations }) => {
      const [first, ...rest] = [...new Set(citations.map(({ sourceId }) => sourceId))];
      return first === undefined ? [] : [{ text, lines: [text], sources: [first, ...rest] }];
    }),
  );

export const contextPremises = ({
  raw,
  summaries,
}: Pick<AssembledContext, 'raw' | 'summaries'>): readonly Premise[] => [
  ...raw.map(slidePremise),
  ...summaryPremises(summaries),
];

/** Each premise whole, then its distinct lines when it has several: a whole slide dilutes its own line's entailment (`docs/adr/0009-explanation-answers.md` § Amendments, 2026-11-03). */
export const scoredPremises = (premises: readonly Premise[]): readonly Premise[] =>
  premises.flatMap((premise) => {
    const lines = [...new Set(premise.lines)];
    return lines.length > 1
      ? [premise, ...lines.map((text) => ({ text, lines: [text], sources: premise.sources }))]
      : [premise];
  });
