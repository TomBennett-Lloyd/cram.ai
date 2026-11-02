import type { SentenceKind } from '@cram/grounding';
import { baselineRow } from './metric-row';
import type { VerifierAccuracy } from './verifier-accuracy';

/** One labelled sentence and the kind the judge returned for it. */
export interface JudgedKind {
  readonly labelled: SentenceKind;
  readonly returned: SentenceKind;
}

const POSITIVE: SentenceKind = 'interpretation';

/** `interpretation` is the positive class: it is the kind that is kept, so precision is the safety figure (#366's plan point 15). */
export const sentenceKindAccuracy = (judged: readonly JudgedKind[]): VerifierAccuracy => {
  const returned = judged.filter((kind) => kind.returned === POSITIVE);
  const labelled = judged.filter((kind) => kind.labelled === POSITIVE);
  return {
    precision: baselineRow(
      returned.filter((kind) => kind.labelled === POSITIVE).length,
      returned.length,
      'the judge returned no interpretation',
    ),
    recall: baselineRow(
      labelled.filter((kind) => kind.returned === POSITIVE).length,
      labelled.length,
      'no labelled sentence is an interpretation',
    ),
  };
};
