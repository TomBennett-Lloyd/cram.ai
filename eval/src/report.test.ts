import { describe, expect, it } from 'vitest';
import { EvalReport, MachineClass } from './report';

describe('MachineClass', () => {
  it('admits each listed class', () => {
    for (const machine of MachineClass.options) expect(MachineClass.parse(machine)).toBe(machine);
  });

  it('refuses a class outside the closed set, so a label cannot drift and split a baseline', () => {
    expect(MachineClass.safeParse('dev-mac').success).toBe(false);
  });
});

describe('EvalReport', () => {
  const { measuredCommit, pullRequest, retrievalK, nliThresholds } = EvalReport.shape;

  it.each(['abc1234', 'a'.repeat(40)])('admits the commit %s', (sha) => {
    expect(measuredCommit.safeParse(sha).success).toBe(true);
  });

  it.each(['abc123', 'a'.repeat(41), 'abc123g', 'ABC1234', 'xabc1234 ', ' abc1234'])(
    'refuses the commit %j',
    (sha) => {
      expect(measuredCommit.safeParse(sha).success).toBe(false);
    },
  );

  it.each([0, -1, 1.5])('refuses the pull request number %d', (number) => {
    expect(pullRequest.safeParse(number).success).toBe(false);
  });

  it.each([0, -1, 1.5])('refuses the retrieval k %d', (k) => {
    expect(retrievalK.safeParse(k).success).toBe(false);
  });

  it.each([-0.1, 1.1])('refuses a threshold of %d', (at) => {
    expect(nliThresholds.safeParse({ entailedAt: at, contradictedAt: 0.5 }).success).toBe(false);
    expect(nliThresholds.safeParse({ entailedAt: 0.5, contradictedAt: at }).success).toBe(false);
  });
});
