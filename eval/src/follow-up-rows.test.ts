import type { ExplainResult } from '@cram/grounding';
import type { SlideRecord } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import type { AskedFollowUp } from './ask-follow-ups';
import { followUp } from './eval-fixture';
import { followUpAttributionRecall, followUpRetrieval } from './follow-up-rows';
import { grounded, NOT_COVERED, record, retrieved, sentence } from './run-fixture';

const cells = record({ slideNo: 1, body: 'Cells are square.' });
const size = record({ slideNo: 2, body: 'Cells are 5 mm across.' });
const other = record({ slideNo: 3, body: 'Bees are busy.' });
const K = 2;

const item = followUp({
  expectedCitations: [
    { lectureId: 'l1', slideNo: 1 },
    { lectureId: 'l1', slideNo: 2 },
  ],
});

const asked = (
  found: readonly SlideRecord[],
  ceiling: readonly SlideRecord[],
  result: ExplainResult = NOT_COVERED,
): AskedFollowUp => ({
  status: 'asked',
  item,
  rewrite: 'How big are cells?',
  retrieved: found.map(retrieved),
  ceiling: ceiling.map(retrieved),
  result,
});

const REWRITE_FAILED: AskedFollowUp = {
  status: 'rewrite-failed',
  item,
  rewrite: {
    status: 'model-failed',
    failure: { status: 'invalid-output', content: '{', issue: 'not JSON' },
  },
};

describe('followUpRetrieval', () => {
  it('passes a follow-up whose rewrite’s top k holds every expected slide the ceiling’s does', () => {
    expect(followUpRetrieval([asked([size, cells], [cells, size])], K)).toEqual({
      status: 'measured',
      bar: 'baseline',
      ratio: { numerator: 1, denominator: 1 },
      failures: [],
    });
  });

  it('fails one naming the slide the ceiling found and the rewrite left outside its top k', () => {
    expect(followUpRetrieval([asked([cells, other, size], [cells, size])], K)).toMatchObject({
      ratio: { numerator: 0, denominator: 1 },
      failures: [
        {
          question: item.question,
          rewrite: 'How big are cells?',
          problems: [{ kind: 'missed-expected-slide', lectureId: 'l1', slideNo: 2 }],
        },
      ],
    });
  });

  it('fails no follow-up over an expected slide the ceiling misses too', () => {
    expect(followUpRetrieval([asked([cells, other], [cells, other])], K)).toMatchObject({
      ratio: { numerator: 1, denominator: 1 },
    });
  });

  it('fails a follow-up whose rewrite failed, with no rewrite to show', () => {
    expect(followUpRetrieval([REWRITE_FAILED], K)).toMatchObject({
      ratio: { numerator: 0, denominator: 1 },
      failures: [{ question: item.question, rewrite: null, problems: [{ kind: 'model-failed' }] }],
    });
  });

  it('is not-measurable when no follow-up was asked', () => {
    expect(followUpRetrieval([], K)).toMatchObject({ status: 'not-measurable' });
  });
});

describe('followUpAttributionRecall', () => {
  it('pools expected slides over the follow-ups, a failed rewrite naming none of them', () => {
    const answer = grounded([sentence('Cells are square.', [cells])], [cells, size]);
    expect(
      followUpAttributionRecall([asked([cells], [cells], answer), REWRITE_FAILED]),
    ).toMatchObject({ ratio: { numerator: 1, denominator: 4 } });
  });

  it('is not-measurable when no follow-up was asked', () => {
    expect(followUpAttributionRecall([])).toMatchObject({ status: 'not-measurable' });
  });
});
