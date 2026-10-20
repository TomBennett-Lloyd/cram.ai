import { z } from 'zod';
import type { ContradictionSetRow } from './contradiction-set';
import { type BaselineRow, NotMeasurable, notMeasurable, passed, type Ratio } from './metric-row';
import type { VerifierAccuracy } from './verifier-accuracy';

/** `tied`: the compared figures are equal, and per-unit latency on the target class decides. */
export const ArmDecision = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('keep') }),
  z.strictObject({
    status: z.literal('drop'),
    failed: z.enum(['contradiction-set', 'precision', 'recall']),
  }),
  z.strictObject({ status: z.literal('tied') }),
  NotMeasurable,
]);
export type ArmDecision = z.infer<typeof ArmDecision>;

export interface ArmEvidence {
  readonly accuracy: VerifierAccuracy;
  readonly contradictionSet: ContradictionSetRow;
}

/** What `docs/adr/0003-model-roles-and-backends.md` § Decision (d)'s rule reads, per verifier strategy. */
export interface ArmsEvidence {
  readonly nli: ArmEvidence;
  readonly llm: Pick<ArmEvidence, 'accuracy'>;
  readonly nliThenLlm: ArmEvidence;
}

export interface ArmDecisions {
  readonly crossEncoderPrimary: ArmDecision;
  readonly secondOpinion: ArmDecision;
}

/** Sign of `a - b`, exact: ratios are compared by cross-multiplying, never as floats. */
const compare = (a: Ratio, b: Ratio): number =>
  Math.sign(a.numerator * b.denominator - b.numerator * a.denominator);

type Compared = { readonly status: 'compared'; readonly sign: number } | NotMeasurable;

const compareRows = (a: BaselineRow, b: BaselineRow, what: string): Compared =>
  a.status === 'measured' && b.status === 'measured'
    ? { status: 'compared', sign: compare(a.ratio, b.ratio) }
    : notMeasurable(`${what} was not measured on both arms`);

const holdsContradictionSet = (row: ContradictionSetRow, arm: string): ArmDecision | undefined => {
  if (row.status === 'not-measurable')
    return notMeasurable(`the ${arm} arm's contradiction set was not measured`);
  return passed(row) ? undefined : { status: 'drop', failed: 'contradiction-set' };
};

/** Primary iff it holds the contradiction set and its precision is not below the LLM path's. */
const crossEncoderPrimary = ({ nli, llm }: ArmsEvidence): ArmDecision => {
  const held = holdsContradictionSet(nli.contradictionSet, 'cross-encoder');
  if (held !== undefined) return held;
  const precision = compareRows(nli.accuracy.precision, llm.accuracy.precision, 'precision');
  if (precision.status === 'not-measurable') return precision;
  if (precision.sign < 0) return { status: 'drop', failed: 'precision' };
  return precision.sign === 0 ? { status: 'tied' } : { status: 'keep' };
};

/** Kept iff it raises recall without lowering precision or failing the contradiction set. */
const secondOpinion = ({ nli, nliThenLlm }: ArmsEvidence): ArmDecision => {
  const held = holdsContradictionSet(nliThenLlm.contradictionSet, 'second-opinion');
  if (held !== undefined) return held;
  const recall = compareRows(nliThenLlm.accuracy.recall, nli.accuracy.recall, 'recall');
  if (recall.status === 'not-measurable') return recall;
  if (recall.sign <= 0) return { status: 'drop', failed: 'recall' };
  const precision = compareRows(nliThenLlm.accuracy.precision, nli.accuracy.precision, 'precision');
  if (precision.status === 'not-measurable') return precision;
  return precision.sign < 0 ? { status: 'drop', failed: 'precision' } : { status: 'keep' };
};

export const verifierArmDecisions = (evidence: ArmsEvidence): ArmDecisions => ({
  crossEncoderPrimary: crossEncoderPrimary(evidence),
  secondOpinion: secondOpinion(evidence),
});
