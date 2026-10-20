import type { VerifyOutcome } from '@cram/grounding';
import type { Verdict } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { type JudgedLabel, verifierAccuracy } from './verifier-accuracy';

const judged = (handVerdict: Verdict, returned: Verdict): JudgedLabel => ({
  handVerdict,
  outcome: { status: 'verified', verdict: returned },
});

const FAILED: VerifyOutcome = {
  status: 'model-failed',
  failure: { status: 'backend-failed', reason: 'down' },
};

describe('verifierAccuracy', () => {
  it('measures precision over returned-supported and recall over labelled-supported', () => {
    expect(
      verifierAccuracy([
        judged('supported', 'supported'),
        judged('unsupported', 'supported'),
        judged('supported', 'unsupported'),
        judged('unsupported', 'unsupported'),
      ]),
    ).toEqual({
      precision: { status: 'measured', bar: 'baseline', ratio: { numerator: 1, denominator: 2 } },
      recall: { status: 'measured', bar: 'baseline', ratio: { numerator: 1, denominator: 2 } },
    });
  });

  it('counts partial as not passed on both sides', () => {
    const { precision, recall } = verifierAccuracy([
      judged('partial', 'supported'),
      judged('supported', 'partial'),
    ]);
    expect(precision).toMatchObject({ ratio: { numerator: 0, denominator: 1 } });
    expect(recall).toMatchObject({ ratio: { numerator: 0, denominator: 1 } });
  });

  it('counts a model failure against recall, never as supported', () => {
    const { precision, recall } = verifierAccuracy([{ handVerdict: 'supported', outcome: FAILED }]);
    expect(precision).toMatchObject({ status: 'not-measurable' });
    expect(recall).toMatchObject({ ratio: { numerator: 0, denominator: 1 } });
  });

  it('is not-measurable on both sides with no labels', () => {
    expect(verifierAccuracy([])).toMatchObject({
      precision: { status: 'not-measurable' },
      recall: { status: 'not-measurable' },
    });
  });
});
