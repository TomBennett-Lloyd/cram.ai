import { describe, expect, it } from 'vitest';
import type { SummaryOutcome } from '@cram/grounding';
import { LectureSummary } from '@cram/shared';
import { summaryRows } from './summary-rows';

const summarised = (units: number, drafted: number): SummaryOutcome => ({
  status: 'summarised',
  summary: LectureSummary.parse({
    lectureId: 'l1',
    units: Array.from({ length: units }, (_, index) => ({
      text: `Line ${String(index)}.`,
      citations: [{ sourceId: 'l1/1', quote: 'q' }],
      kind: 'lecture-summary',
    })),
  }),
  withheld: [],
  drafted,
});

describe('summaryRows', () => {
  it('counts lectures with a summary over lectures, and stored units over drafted units', () => {
    const failed: SummaryOutcome = {
      status: 'model-failed',
      stage: 'generate',
      failure: { status: 'backend-failed', reason: 'down' },
      drafted: 4,
    };
    const none: SummaryOutcome = {
      status: 'unsummarised',
      reason: 'no-unit-survived',
      withheld: [],
      drafted: 3,
    };
    expect(summaryRows([summarised(2, 5), failed, none, summarised(1, 1)])).toEqual({
      summaryYield: {
        status: 'measured',
        bar: 'baseline',
        ratio: { numerator: 2, denominator: 4 },
      },
      summaryUnitYield: {
        status: 'measured',
        bar: 'baseline',
        ratio: { numerator: 3, denominator: 13 },
      },
    });
  });

  it('is not measurable with no lecture, or with no unit drafted', () => {
    expect(summaryRows([])).toEqual({
      summaryYield: { status: 'not-measurable', reason: 'the course has no lecture' },
      summaryUnitYield: { status: 'not-measurable', reason: 'no summary call drafted a unit' },
    });
    const empty: SummaryOutcome = {
      status: 'unsummarised',
      reason: 'nothing-to-summarise',
      withheld: [],
      drafted: 0,
    };
    expect(summaryRows([empty]).summaryYield).toMatchObject({
      ratio: { numerator: 0, denominator: 1 },
    });
  });
});
