import { describe, expect, it } from 'vitest';
import { examAnswerability, gradingAgreement } from './exam-metrics';

describe('examAnswerability', () => {
  it('yields a question only when its gold answer and every rubric point are supported', () => {
    expect(
      examAnswerability([
        { goldAnswer: 'supported', rubricPoints: ['supported', 'supported'] },
        { goldAnswer: 'supported', rubricPoints: ['supported', 'partial'] },
        { goldAnswer: 'partial', rubricPoints: ['supported'] },
        { goldAnswer: 'supported', rubricPoints: [] },
      ]),
    ).toMatchObject({ ratio: { numerator: 2, denominator: 4 } });
  });

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
