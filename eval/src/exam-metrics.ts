import type { Verdict } from '@cram/shared';
import { type BaselineRow, baselineRow } from './metric-row';

/** One generated exam question's verdicts before the drop. */
export interface GeneratedQuestionVerdicts {
  readonly goldAnswer: Verdict;
  readonly rubricPoints: readonly Verdict[];
}

/** The yield (`docs/adr/0005-evaluation-as-gate.md` § Decision (d)): gold answer and every rubric point supported. */
export const examAnswerability = (generated: readonly GeneratedQuestionVerdicts[]): BaselineRow =>
  baselineRow(
    generated.filter(
      ({ goldAnswer, rubricPoints }) =>
        goldAnswer === 'supported' && rubricPoints.every((verdict) => verdict === 'supported'),
    ).length,
    generated.length,
    'no exam question was generated',
  );

/** One rubric point's verdict from the grading judge beside its hand mark. */
export interface MarkedPoint<V> {
  readonly judge: V;
  readonly hand: V;
}

/** Of the hand-marked rubric-point verdicts, those the judge matched (§ Decision (d)). */
export const gradingAgreement = <V>(points: readonly MarkedPoint<V>[]): BaselineRow =>
  baselineRow(
    points.filter(({ judge, hand }) => judge === hand).length,
    points.length,
    'no rubric-point verdict carries a hand mark',
  );
