import { describe, expect, it } from 'vitest';
import type { ContradictionSetRow } from './contradiction-set';
import { type BaselineRow, baselineRow, notMeasurable } from './metric-row';
import type { VerifierAccuracy } from './verifier-accuracy';
import { type ArmsEvidence, verifierArmDecisions } from './verifier-arms';

const rate = (numerator: number, denominator: number): BaselineRow =>
  baselineRow(numerator, denominator, 'empty');

const accuracy = (precision: BaselineRow, recall: BaselineRow): VerifierAccuracy => ({
  precision,
  recall,
});

const HELD: ContradictionSetRow = {
  status: 'measured',
  bar: 'absolute',
  ratio: { numerator: 1, denominator: 1 },
  failures: [],
};
const BROKEN: ContradictionSetRow = {
  status: 'measured',
  bar: 'absolute',
  ratio: { numerator: 0, denominator: 1 },
  failures: [{ question: 'q', problems: [{ kind: 'no-expected-citation' }] }],
};

const evidence = (overrides: Partial<ArmsEvidence> = {}): ArmsEvidence => ({
  nli: { accuracy: accuracy(rate(3, 4), rate(2, 4)), contradictionSet: HELD },
  llm: { accuracy: accuracy(rate(2, 4), rate(3, 4)) },
  nliThenLlm: { accuracy: accuracy(rate(3, 4), rate(3, 4)), contradictionSet: HELD },
  ...overrides,
});

const primary = (overrides: Partial<ArmsEvidence>) =>
  verifierArmDecisions(evidence(overrides)).crossEncoderPrimary;
const second = (overrides: Partial<ArmsEvidence>) =>
  verifierArmDecisions(evidence(overrides)).secondOpinion;

describe('verifierArmDecisions — cross-encoder primary', () => {
  it('keeps it when it holds the set and its precision is above the LLM path’s', () => {
    expect(primary({})).toEqual({ status: 'keep' });
  });

  it('drops it when it fails the contradiction set, whatever its precision', () => {
    expect(
      primary({ nli: { accuracy: accuracy(rate(4, 4), rate(2, 4)), contradictionSet: BROKEN } }),
    ).toEqual({ status: 'drop', failed: 'contradiction-set' });
  });

  it('drops it when its precision is below the LLM path’s', () => {
    expect(
      primary({ nli: { accuracy: accuracy(rate(1, 4), rate(2, 4)), contradictionSet: HELD } }),
    ).toEqual({ status: 'drop', failed: 'precision' });
  });

  it('is tied when the precisions are equal as ratios, not as counts', () => {
    expect(
      primary({ nli: { accuracy: accuracy(rate(1, 2), rate(2, 4)), contradictionSet: HELD } }),
    ).toEqual({ status: 'tied' });
  });

  it('is not-measurable when the LLM path’s precision was not measured', () => {
    expect(primary({ llm: { accuracy: accuracy(notMeasurable('none'), rate(1, 1)) } })).toEqual({
      status: 'not-measurable',
      reason: 'precision was not measured on both arms',
    });
  });

  it('is not-measurable when its contradiction set was not measured', () => {
    expect(
      primary({
        nli: { accuracy: accuracy(rate(3, 4), rate(2, 4)), contradictionSet: notMeasurable('x') },
      }),
    ).toMatchObject({ status: 'not-measurable' });
  });
});

describe('verifierArmDecisions — second opinion', () => {
  it('keeps it when it raises recall without lowering precision', () => {
    expect(second({})).toEqual({ status: 'keep' });
  });

  it('drops it when it fails the contradiction set', () => {
    expect(
      second({
        nliThenLlm: { accuracy: accuracy(rate(3, 4), rate(4, 4)), contradictionSet: BROKEN },
      }),
    ).toEqual({ status: 'drop', failed: 'contradiction-set' });
  });

  it('drops it when recall does not rise', () => {
    expect(
      second({
        nliThenLlm: { accuracy: accuracy(rate(4, 4), rate(2, 4)), contradictionSet: HELD },
      }),
    ).toEqual({ status: 'drop', failed: 'recall' });
  });

  it('drops it when recall rises but precision falls', () => {
    expect(
      second({
        nliThenLlm: { accuracy: accuracy(rate(2, 4), rate(4, 4)), contradictionSet: HELD },
      }),
    ).toEqual({ status: 'drop', failed: 'precision' });
  });

  it('is not-measurable when recall was not measured on both arms', () => {
    expect(
      second({
        nliThenLlm: {
          accuracy: accuracy(rate(3, 4), notMeasurable('none')),
          contradictionSet: HELD,
        },
      }),
    ).toMatchObject({ status: 'not-measurable', reason: 'recall was not measured on both arms' });
  });

  it('is not-measurable when precision was not measured on both arms', () => {
    expect(
      second({
        nliThenLlm: {
          accuracy: accuracy(notMeasurable('none'), rate(4, 4)),
          contradictionSet: HELD,
        },
      }),
    ).toMatchObject({
      status: 'not-measurable',
      reason: 'precision was not measured on both arms',
    });
  });
});
