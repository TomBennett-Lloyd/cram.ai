import { describe, expect, it } from 'vitest';
import { question } from './eval-fixture';
import { retrievalRecall } from './retrieval-recall';
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
