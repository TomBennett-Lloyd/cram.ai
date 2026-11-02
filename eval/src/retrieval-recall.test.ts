import { describe, expect, it } from 'vitest';
import { question } from './eval-fixture';
import { misspeltRetrievalRecall, retrievalRecall } from './retrieval-recall';
import { asked, NOT_COVERED, record } from './run-fixture';

const s1 = record({ slideNo: 1 });
const s2 = record({ slideNo: 2 });
const s3 = record({ slideNo: 3 });
const twoExpected = question({
  expectedCitations: [
    { lectureId: 'l1', slideNo: 1 },
    { lectureId: 'l1', slideNo: 3 },
  ],
});

describe('retrievalRecall', () => {
  it('pools expected slides over questions and counts those retrieved', () => {
    expect(retrievalRecall([asked(NOT_COVERED, [s2, s1], twoExpected)], 8)).toEqual({
      status: 'measured',
      bar: 'baseline',
      ratio: { numerator: 1, denominator: 2 },
    });
  });

  it('counts only the top k', () => {
    expect(retrievalRecall([asked(NOT_COVERED, [s2, s1, s3], twoExpected)], 2)).toMatchObject({
      ratio: { numerator: 1, denominator: 2 },
    });
  });

  it('matches by lecture as well as slide number', () => {
    const otherLecture = record({ lectureId: 'l2', slideNo: 1 });
    expect(retrievalRecall([asked(NOT_COVERED, [otherLecture], twoExpected)], 8)).toMatchObject({
      ratio: { numerator: 0 },
    });
  });

  it('skips a question with no expected slide', () => {
    const uncovered = question({ expectedCitations: [] });
    expect(retrievalRecall([asked(NOT_COVERED, [s1], uncovered)], 8)).toMatchObject({
      status: 'not-measurable',
    });
  });
});

describe('misspeltRetrievalRecall', () => {
  it('pools per variant, so one variant missing a slide is not hidden by its sibling', () => {
    const variants = [
      asked(NOT_COVERED, [s1, s3], twoExpected),
      asked(NOT_COVERED, [s1], twoExpected),
    ];
    expect(misspeltRetrievalRecall(variants, 8)).toMatchObject({
      ratio: { numerator: 3, denominator: 4 },
    });
  });

  it('counts only the top k', () => {
    expect(
      misspeltRetrievalRecall([asked(NOT_COVERED, [s2, s1, s3], twoExpected)], 2),
    ).toMatchObject({
      ratio: { numerator: 1, denominator: 2 },
    });
  });

  it('says why when no question carries a variant', () => {
    expect(misspeltRetrievalRecall([], 8)).toEqual({
      status: 'not-measurable',
      reason: 'no golden question carries a misspelt variant',
    });
  });
});
