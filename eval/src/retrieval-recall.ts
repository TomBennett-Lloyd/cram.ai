import type { AskedQuestion } from './asked-question';
import { type BaselineRow, baselineRow } from './metric-row';

type Retrieval = Pick<AskedQuestion, 'question' | 'retrieved'>;

const pooledRecall = (retrievals: readonly Retrieval[], k: number, empty: string): BaselineRow => {
  let expected = 0;
  let found = 0;
  for (const { question, retrieved } of retrievals) {
    const top = retrieved.slice(0, k).map(({ record }) => record);
    for (const ref of question.expectedCitations) {
      expected += 1;
      if (
        top.some((record) => record.lectureId === ref.lectureId && record.slideNo === ref.slideNo)
      )
        found += 1;
    }
  }
  return baselineRow(found, expected, empty);
};

/**
 * Of the expected slides pooled over every question that has any, those in that question's
 * top `k` retrieved (`docs/adr/0005-evaluation-as-gate.md` § Decision (d)).
 */
export const retrievalRecall = (asked: readonly Retrieval[], k: number): BaselineRow =>
  pooledRecall(asked, k, 'no golden question names an expected slide');

export const misspeltRetrievalRecall = (variants: readonly Retrieval[], k: number): BaselineRow =>
  pooledRecall(variants, k, 'no golden question carries a misspelt variant');
