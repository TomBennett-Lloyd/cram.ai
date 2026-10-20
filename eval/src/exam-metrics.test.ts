import { describe, expect, it } from 'vitest';
import { examAnswerability, gradingAgreement } from './exam-metrics';

describe('examAnswerability', () => {
  it.each([
    { goldAnswer: 'supported', rubricPoints: ['supported', 'supported'], yields: 1 },
    { goldAnswer: 'supported', rubricPoints: ['supported', 'partial'], yields: 0 },
    { goldAnswer: 'partial', rubricPoints: ['supported'], yields: 0 },
    { goldAnswer: 'supported', rubricPoints: [], yields: 1 },
  ] as const)(
    'yields $goldAnswer gold with rubric $rubricPoints only when every verdict is supported',
    ({ goldAnswer, rubricPoints, yields }) => {
      expect(examAnswerability([{ goldAnswer, rubricPoints }])).toMatchObject({
        ratio: { numerator: yields, denominator: 1 },
      });
    },
  );

  it('is not-measurable with no generated question', () => {
    expect(examAnswerability([])).toMatchObject({ status: 'not-measurable' });
  });
});

describe('gradingAgreement', () => {
  it('counts the judge verdicts matching their hand marks', () => {
    expect(
      gradingAgreement([
        { judge: 'met', hand: 'met' },
        { judge: 'met', hand: 'not-met' },
        { judge: 'not-met', hand: 'not-met' },
      ]),
    ).toMatchObject({ ratio: { numerator: 2, denominator: 3 } });
  });

  it('is not-measurable with no hand-marked verdict', () => {
    expect(gradingAgreement([])).toMatchObject({ status: 'not-measurable' });
  });
});
