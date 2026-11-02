import { describe, expect, it } from 'vitest';
import { type JudgedKind, sentenceKindAccuracy } from './sentence-kind-accuracy';

const judged = (
  labelled: JudgedKind['labelled'],
  returned: JudgedKind['returned'],
): JudgedKind => ({
  labelled,
  returned,
});

describe('sentenceKindAccuracy', () => {
  it('reads interpretation as the positive class on both rows', () => {
    const sample = [
      judged('interpretation', 'interpretation'),
      judged('course-claim', 'interpretation'),
      judged('course-claim', 'interpretation'),
      judged('interpretation', 'course-claim'),
      judged('course-claim', 'course-claim'),
    ];
    expect(sentenceKindAccuracy(sample)).toEqual({
      precision: { status: 'measured', bar: 'baseline', ratio: { numerator: 1, denominator: 3 } },
      recall: { status: 'measured', bar: 'baseline', ratio: { numerator: 1, denominator: 2 } },
    });
  });

  it('says why each row has no denominator', () => {
    expect(sentenceKindAccuracy([judged('course-claim', 'course-claim')])).toEqual({
      precision: { status: 'not-measurable', reason: 'the judge returned no interpretation' },
      recall: { status: 'not-measurable', reason: 'no labelled sentence is an interpretation' },
    });
  });
});
