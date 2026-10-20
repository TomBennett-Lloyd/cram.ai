import type { VerifyOutcome } from '@cram/grounding';
import type { Verdict } from '@cram/shared';
import { type BaselineRow, baselineRow } from './metric-row';

/** One hand label and what the verifier returned for it. */
export interface JudgedLabel {
  readonly handVerdict: Verdict;
  readonly outcome: VerifyOutcome;
}

export interface VerifierAccuracy {
  readonly precision: BaselineRow;
  readonly recall: BaselineRow;
}

/** A model failure is not a `supported` verdict, so it counts against recall. */
const returnedSupported = (outcome: VerifyOutcome): boolean =>
  outcome.status === 'verified' && outcome.verdict === 'supported';

/** `docs/adr/0005-evaluation-as-gate.md` § Decision (d); `partial` counts as not passed on both sides. */
export const verifierAccuracy = (judged: readonly JudgedLabel[]): VerifierAccuracy => {
  const returned = judged.filter(({ outcome }) => returnedSupported(outcome));
  const labelled = judged.filter(({ handVerdict }) => handVerdict === 'supported');
  return {
    precision: baselineRow(
      returned.filter(({ handVerdict }) => handVerdict === 'supported').length,
      returned.length,
      'the verifier returned no supported verdict',
    ),
    recall: baselineRow(
      labelled.filter(({ outcome }) => returnedSupported(outcome)).length,
      labelled.length,
      'no hand label is supported',
    ),
  };
};
