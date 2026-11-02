import type { LoadedSummary, RetrievedSlide, SourceId } from '@cram/shared';
import type { AssembledContext } from './assemble-context';
import { slideText } from './slide-text';

/** A text a sentence is scored against, and the slides it credits (`docs/adr/0009-explanation-answers.md` § Decision (d)). */
export interface Premise {
  readonly text: string;
  readonly sources: readonly [SourceId, ...SourceId[]];
}

export const slidePremise = ({ sourceId, record }: RetrievedSlide): Premise => ({
  text: slideText(record),
  sources: [sourceId],
});

/** Each loaded unit, attributed to the slides it cites; a unit citing none credits nothing, so it is no premise. */
export const summaryPremises = (summaries: readonly LoadedSummary[]): readonly Premise[] =>
  summaries.flatMap(({ summary }) =>
    summary.units.flatMap(({ text, citations }) => {
      const [first, ...rest] = [...new Set(citations.map(({ sourceId }) => sourceId))];
      return first === undefined ? [] : [{ text, sources: [first, ...rest] }];
    }),
  );

export const contextPremises = ({
  raw,
  summaries,
}: Pick<AssembledContext, 'raw' | 'summaries'>): readonly Premise[] => [
  ...raw.map(slidePremise),
  ...summaryPremises(summaries),
];
