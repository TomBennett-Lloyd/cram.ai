import type { ExplainResult } from '@cram/grounding';
import type { AttributedSentence, RetrievedSlide, SourceId } from '@cram/shared';
import type { GoldenQuestion, SlideRef } from './golden-question';

/** One golden question as the runner asked it at one depth: what retrieval returned and what the explanation made of it. */
export interface AskedQuestion {
  readonly question: GoldenQuestion;
  readonly retrieved: readonly RetrievedSlide[];
  readonly result: ExplainResult;
}

/** The sentences shown (`docs/adr/0009-explanation-answers.md` § Decision (o)); the withheld panel is not shown text. */
export const shownSentences = (result: ExplainResult): readonly AttributedSentence[] =>
  result.status === 'grounded' ? result.explanation.sentences : [];

/** Whether `sourceId` names, among `slides`, one of `expected`. */
export const namesExpected = (
  sourceId: SourceId,
  slides: readonly RetrievedSlide[],
  expected: readonly SlideRef[],
): boolean => {
  const record = slides.find((slide) => slide.sourceId === sourceId)?.record;
  return (
    record !== undefined &&
    expected.some((ref) => ref.lectureId === record.lectureId && ref.slideNo === record.slideNo)
  );
};
