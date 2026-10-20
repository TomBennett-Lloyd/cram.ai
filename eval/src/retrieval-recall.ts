import type { AskedQuestion } from './asked-question';
import { type BaselineRow, baselineRow } from './metric-row';

/**
 * Of the expected slides pooled over every question that has any, those in that question's
 * top `k` retrieved (`docs/adr/0005-evaluation-as-gate.md` § Decision (d)).
 */
export const retrievalRecall = (
  asked: readonly Pick<AskedQuestion, 'question' | 'retrieved'>[],
  k: number,
): BaselineRow => {
  let expected = 0;
  let found = 0;
  for (const { question, retrieved } of asked) {
    const top = retrieved.slice(0, k).map(({ record }) => record);
    for (const ref of question.expectedCitations) {
      expected += 1;
      if (
        top.some((record) => record.lectureId === ref.lectureId && record.slideNo === ref.slideNo)
      )
        found += 1;
    }
  }
  return baselineRow(found, expected, 'no golden question names an expected slide');
};
